//! Safe batch rename (Plan item 29, Phase 2).
//!
//! A rename is planned completely before anything on disk changes: every
//! photo's new name comes from the template (`naming`), and every file that
//! belongs to it moves with it (its `.tirdata` and virtual-copy sidecars,
//! `IMG_1.CR3.xmp`, and `IMG_1.xmp`). Clashes are found for the whole batch at
//! once and case-insensitively, as macOS and Windows compare names. Files
//! move to temporary names first and then to their new names, so chains,
//! swaps and case-only renames work, and any failure puts every file back.
//!
//! A stem XMP (`IMG_1.xmp`) is shared by every image with that stem, e.g. a
//! RAW+JPEG pair. Only selected files are renamed (owner, 2026-11-16): one
//! renamed away from a partner gets a copy of the shared XMP and the partner
//! keeps the original; when every file sharing it is renamed, it moves.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::file_management::{
    original_file_name, parse_sidecar_filename, parse_virtual_path, remember_original_file_name,
    sync_album_path_changes,
};
use crate::formats::is_supported_image_file;
use crate::naming::{NamingSource, Template, TemplateError, file_stem_from_rendered};

/// Why a photo cannot take its new name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RenameClash {
    /// Another photo of the batch would get the same name.
    Batch,
    /// A file that is not being renamed already has the name.
    ExistingFile,
    /// A sidecar or XMP that is not being renamed already has one of the
    /// photo's sidecar names, e.g. one left behind by a deleted photo, whose
    /// edits the photo would otherwise take over.
    ExistingSidecar,
}

/// One photo of a rename: its physical file, the new file name, and what the
/// template could not fill or had to clean.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePreviewItem {
    pub path: String,
    pub new_name: String,
    pub missing: Vec<String>,
    pub cleaned: bool,
    pub unchanged: bool,
    pub clash: Option<RenameClash>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePreview {
    pub items: Vec<RenamePreviewItem>,
    pub errors: Vec<TemplateError>,
    pub clash_count: usize,
}

/// A file move or copy, and the photo (index into the preview) it belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FileOperation {
    from: PathBuf,
    to: PathBuf,
    photo: usize,
}

#[derive(Debug)]
struct RenamePlan {
    preview: RenamePreview,
    moves: Vec<FileOperation>,
    /// Shared stem XMPs copied for files renamed away from a partner; `from`
    /// is where the XMP is once the moves are done.
    copies: Vec<FileOperation>,
    /// Old → new path of every renamed photo.
    renamed: Vec<(PathBuf, PathBuf)>,
}

/// The files of one folder, looked up by name.
struct FolderListing {
    /// Every entry, lower-cased, for clash checks.
    lower_names: Vec<PathBuf>,
    /// `.tirdata` files by the image file name they belong to.
    sidecars: HashMap<String, Vec<PathBuf>>,
    /// Images by file stem.
    images_by_stem: HashMap<String, Vec<PathBuf>>,
}

impl FolderListing {
    fn read(dir: &Path) -> Self {
        let mut listing = Self {
            lower_names: Vec::new(),
            sidecars: HashMap::new(),
            images_by_stem: HashMap::new(),
        };
        for path in fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(|entry| Some(entry.ok()?.path()))
        {
            listing.lower_names.push(lower(&path));
            let name = file_name(&path);
            if let Some((image_name, _)) = parse_sidecar_filename(&name) {
                listing.sidecars.entry(image_name).or_default().push(path);
            } else if is_supported_image_file(&path) {
                listing
                    .images_by_stem
                    .entry(file_stem(&path))
                    .or_default()
                    .push(path);
            }
        }
        listing
    }
}

fn lower(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn parent(path: &Path) -> &Path {
    path.parent().unwrap_or(Path::new(""))
}

/// `name.xmp` or `name.XMP` in `dir`, whichever exists.
pub(crate) fn existing_xmp(dir: &Path, name: &str) -> Option<PathBuf> {
    ["xmp", "XMP"]
        .into_iter()
        .map(|extension| dir.join(format!("{name}.{extension}")))
        .find(|path| path.is_file())
}

/// `dir/name` with the extension of the XMP `like` (`xmp` or `XMP`).
fn xmp_like(like: &Path, name: &str) -> PathBuf {
    let extension = like.extension().unwrap_or_default().to_string_lossy();
    parent(like).join(format!("{name}.{extension}"))
}

/// The unique physical files behind `paths` (virtual copies share theirs), in
/// order.
fn physical_paths(paths: &[String]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .iter()
        .map(|path| parse_virtual_path(path).0)
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn plan_rename(paths: &[String], template: &str, texts: &[String]) -> Result<RenamePlan, String> {
    let parsed = Template::parse(template);
    let sources = physical_paths(paths);
    let total = sources.len();

    let mut items = Vec::with_capacity(total);
    let mut targets = Vec::with_capacity(total);
    for (index, source) in sources.iter().enumerate() {
        if !source.is_file() {
            return Err(format!("File not found: {}", source.display()));
        }
        let naming =
            NamingSource::new(&source.to_string_lossy(), index + 1, total).with_texts(texts);
        let rendered = parsed.template.render(&naming);
        let stem = file_stem_from_rendered(&rendered, &naming);
        let new_name = match source.extension() {
            Some(extension) => format!("{stem}.{}", extension.to_string_lossy()),
            None => stem,
        };
        let target = source.with_file_name(&new_name);
        items.push(RenamePreviewItem {
            path: source.to_string_lossy().into_owned(),
            unchanged: target == *source,
            new_name,
            missing: rendered.missing,
            cleaned: rendered.cleaned,
            clash: None,
        });
        targets.push(target);
    }

    let renaming: HashMap<&Path, (usize, &Path)> = sources
        .iter()
        .zip(&targets)
        .enumerate()
        .filter(|(index, _)| !items[*index].unchanged)
        .map(|(index, (source, target))| (source.as_path(), (index, target.as_path())))
        .collect();
    let mut listings: HashMap<&Path, FolderListing> = HashMap::new();
    for source in renaming.keys() {
        listings
            .entry(parent(source))
            .or_insert_with(|| FolderListing::read(parent(source)));
    }

    let mut moves = Vec::new();
    let mut copies = Vec::new();
    let mut renamed = Vec::new();
    let mut shared_xmps_done = HashSet::new();
    for (index, (source, target)) in sources.iter().zip(&targets).enumerate() {
        if items[index].unchanged {
            continue;
        }
        let dir = parent(source);
        let listing = &listings[dir];
        let source_name = file_name(source);
        let target_name = file_name(target);
        renamed.push((source.clone(), target.clone()));
        moves.push(FileOperation {
            from: source.clone(),
            to: target.clone(),
            photo: index,
        });

        for sidecar in listing.sidecars.get(&source_name).into_iter().flatten() {
            let sidecar_name = file_name(sidecar);
            let rest = &sidecar_name[source_name.len()..];
            moves.push(FileOperation {
                from: sidecar.clone(),
                to: dir.join(format!("{target_name}{rest}")),
                photo: index,
            });
        }

        if let Some(xmp) = existing_xmp(dir, &source_name) {
            moves.push(FileOperation {
                to: xmp_like(&xmp, &target_name),
                from: xmp,
                photo: index,
            });
        }

        let stem = file_stem(source);
        if let Some(shared) = existing_xmp(dir, &stem)
            && shared_xmps_done.insert(lower(&shared))
        {
            let sharers = listing
                .images_by_stem
                .get(&stem)
                .map_or(&[][..], Vec::as_slice);
            plan_shared_xmp(&shared, &stem, sharers, &renaming, &mut moves, &mut copies);
        }
    }

    // A name is taken when a file that is not moving away has it, or when
    // another operation of the batch already claims it.
    let vacated: HashSet<PathBuf> = moves.iter().map(|op| lower(&op.from)).collect();
    let staying: HashSet<&PathBuf> = listings
        .values()
        .flat_map(|listing| &listing.lower_names)
        .filter(|path| !vacated.contains(*path))
        .collect();
    let mut claimed: HashMap<PathBuf, usize> = HashMap::new();
    fn flag(items: &mut [RenamePreviewItem], photo: usize, clash: RenameClash) {
        items[photo].clash.get_or_insert(clash);
    }
    for op in moves.iter().chain(&copies) {
        let key = lower(&op.to);
        if staying.contains(&key) {
            let is_photo = targets[op.photo] == op.to;
            let clash = if is_photo {
                RenameClash::ExistingFile
            } else {
                RenameClash::ExistingSidecar
            };
            flag(&mut items, op.photo, clash);
        } else if let Some(&other) = claimed.get(&key) {
            flag(&mut items, other, RenameClash::Batch);
            flag(&mut items, op.photo, RenameClash::Batch);
        } else {
            claimed.insert(key, op.photo);
        }
    }
    // Sidecar names the photo does not bring along must be free too, or it
    // would take over another photo's edits.
    for &(photo, target) in renaming.values() {
        let target_name = file_name(target);
        let target_stem = file_stem(target);
        let taken = [
            format!("{target_name}.tirdata"),
            format!("{target_name}.xmp"),
            format!("{target_stem}.xmp"),
        ]
        .iter()
        .any(|name| staying.contains(&lower(&parent(target).join(name))));
        if taken {
            flag(&mut items, photo, RenameClash::ExistingSidecar);
        }
    }

    let clash_count = items.iter().filter(|item| item.clash.is_some()).count();
    Ok(RenamePlan {
        preview: RenamePreview {
            items,
            errors: parsed.errors,
            clash_count,
        },
        moves,
        copies,
        renamed,
    })
}

/// Moves or copies the stem XMP `shared` (`dir/stem.xmp`) for the images
/// sharing it (`sharers`), renamed or not.
fn plan_shared_xmp(
    shared: &Path,
    stem: &str,
    sharers: &[PathBuf],
    renaming: &HashMap<&Path, (usize, &Path)>,
    moves: &mut Vec<FileOperation>,
    copies: &mut Vec<FileOperation>,
) {
    // The original stays when a sharer keeps the stem; every new stem a
    // sharer takes, with the photo that takes it there.
    let mut kept = false;
    let mut new_stems: Vec<(String, usize)> = Vec::new();
    for sharer in sharers {
        match renaming.get(sharer.as_path()) {
            Some(&(photo, target)) if file_stem(target) != stem => {
                let new_stem = file_stem(target);
                if !new_stems.iter().any(|(existing, _)| *existing == new_stem) {
                    new_stems.push((new_stem, photo));
                }
            }
            _ => kept = true,
        }
    }

    let mut new_stems = new_stems.into_iter();
    let after_moves = if kept {
        shared.to_path_buf()
    } else {
        let Some((first, photo)) = new_stems.next() else {
            return;
        };
        let to = xmp_like(shared, &first);
        moves.push(FileOperation {
            from: shared.to_path_buf(),
            to: to.clone(),
            photo,
        });
        to
    };
    for (new_stem, photo) in new_stems {
        copies.push(FileOperation {
            from: after_moves.clone(),
            to: xmp_like(shared, &new_stem),
            photo,
        });
    }
}

/// A name no file has, beside `path`, for the first step of its move.
fn temporary_path(path: &Path, index: usize) -> PathBuf {
    let id = uuid::Uuid::new_v4().simple();
    parent(path).join(format!(".tir-rename-{id}-{index}"))
}

/// Carries out the plan's moves and copies, or puts every file back and
/// returns the first error.
fn apply_plan(plan: &RenamePlan) -> Result<(), String> {
    let temporaries: Vec<PathBuf> = plan
        .moves
        .iter()
        .enumerate()
        .map(|(index, op)| temporary_path(&op.from, index))
        .collect();

    for (index, op) in plan.moves.iter().enumerate() {
        if let Err(error) = fs::rename(&op.from, &temporaries[index]) {
            restore(plan, &temporaries, index, 0);
            return Err(format!("Could not rename {}: {error}", op.from.display()));
        }
    }
    for (index, op) in plan.moves.iter().enumerate() {
        if let Err(error) = fs::rename(&temporaries[index], &op.to) {
            restore(plan, &temporaries, plan.moves.len(), index);
            return Err(format!("Could not rename to {}: {error}", op.to.display()));
        }
    }

    let mut created = Vec::new();
    for op in &plan.copies {
        let copied = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&op.to)
            .and_then(|mut file| {
                created.push(op.to.clone());
                std::io::copy(&mut fs::File::open(&op.from)?, &mut file)
            });
        if let Err(error) = copied {
            for path in &created {
                let _ = fs::remove_file(path);
            }
            restore(plan, &temporaries, plan.moves.len(), plan.moves.len());
            return Err(format!("Could not copy {}: {error}", op.from.display()));
        }
    }
    Ok(())
}

/// Undoes a partly applied plan: the first `at_final` moves reached their new
/// names and the first `at_temporary` their temporary ones.
fn restore(plan: &RenamePlan, temporaries: &[PathBuf], at_temporary: usize, at_final: usize) {
    for index in (0..at_final).rev() {
        let op = &plan.moves[index];
        if let Err(error) = fs::rename(&op.to, &temporaries[index]) {
            log::error!(
                "Rename rollback: could not move {} back: {error}",
                op.to.display()
            );
        }
    }
    for index in (0..at_temporary).rev() {
        let op = &plan.moves[index];
        if let Err(error) = fs::rename(&temporaries[index], &op.from) {
            log::error!(
                "Rename rollback: could not restore {} from {}: {error}",
                op.from.display(),
                temporaries[index].display()
            );
        }
    }
}

/// What renaming `paths` with `name_template` would do; nothing on disk
/// changes.
#[tauri::command]
pub async fn preview_rename(
    paths: Vec<String>,
    name_template: String,
    texts: Option<Vec<String>>,
) -> Result<RenamePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plan_rename(&paths, &name_template, &texts.unwrap_or_default()).map(|plan| plan.preview)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Renames `paths` (images or virtual copies) with `name_template`, all or
/// none. Returns every input path as it is afterwards, in order.
#[tauri::command]
pub async fn rename_files(
    paths: Vec<String>,
    name_template: String,
    texts: Option<Vec<String>>,
    app_handle: AppHandle,
) -> Result<Vec<String>, String> {
    let order_handle = app_handle.clone();
    crate::blocking_command::run_in_file_order(&order_handle, move || {
        rename_files_blocking(
            &paths,
            &name_template,
            &texts.unwrap_or_default(),
            &app_handle,
        )
    })
    .await
}

fn rename_files_blocking(
    paths: &[String],
    template: &str,
    texts: &[String],
    app_handle: &AppHandle,
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let check_clashes =
        |plan: &RenamePlan| match plan.preview.items.iter().find(|i| i.clash.is_some()) {
            Some(item) => Err(format!(
                "{} of the new names are already taken, e.g. {}.",
                plan.preview.clash_count, item.new_name
            )),
            None => Ok(()),
        };
    let plan = plan_rename(paths, template, texts)?;
    check_clashes(&plan)?;
    // Remembering an original name may create a `.tirdata`, so plan again with it.
    let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
    preserve_original_names(&plan.renamed, settings.enable_xmp_sync.unwrap_or(false))?;
    let plan = plan_rename(paths, template, texts)?;
    check_clashes(&plan)?;
    apply_plan(&plan)?;

    let renames = path_map(&plan.renamed);
    sync_album_path_changes(app_handle, Some(&renames), None, None);
    crate::keyword_index::follow_renames(app_handle, &renames);
    if let Err(error) = crate::library_catalog::follow_thumbnail_renames(app_handle, &renames) {
        log::warn!("Could not update the thumbnail index after a rename: {error}");
    }
    crate::editor_round_trip::follow_renames(app_handle, &renames);

    Ok(paths
        .iter()
        .map(|path| renamed_path(path, &renames))
        .collect())
}

/// Remembers each photo's name from before its first rename (`remember_original_file_name`).
/// Runs before the moves; it stays if the rename then fails, which is harmless since it is
/// the photo's true original name.
fn preserve_original_names(
    renamed: &[(PathBuf, PathBuf)],
    enable_xmp_sync: bool,
) -> Result<(), String> {
    for (source, _) in renamed {
        remember_original_file_name(source, &original_file_name(source), enable_xmp_sync)?;
    }
    Ok(())
}

fn path_map(renamed: &[(PathBuf, PathBuf)]) -> HashMap<String, String> {
    renamed
        .iter()
        .map(|(old, new)| {
            (
                old.to_string_lossy().into_owned(),
                new.to_string_lossy().into_owned(),
            )
        })
        .collect()
}

/// `path` (an image or a virtual copy, with or without a copy's display name)
/// after the renames in `renames` (physical old → new paths).
pub fn renamed_path(path: &str, renames: &HashMap<String, String>) -> String {
    let (base, copy_query) = match path.split_once("?vc=") {
        Some((base, query)) => (base, format!("?vc={query}")),
        None => (path, String::new()),
    };
    let new_base = renames.get(base).map_or(base, String::as_str);
    format!("{new_base}{copy_query}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_management::extract_xmp_preserved_file_name;

    fn folder_with(names: &[&str]) -> tempfile::TempDir {
        let folder = tempfile::tempdir().unwrap();
        for name in names {
            fs::write(folder.path().join(name), name.as_bytes()).unwrap();
        }
        folder
    }

    fn path(folder: &tempfile::TempDir, name: &str) -> String {
        folder.path().join(name).to_string_lossy().into_owned()
    }

    fn names(folder: &tempfile::TempDir) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(folder.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn content(folder: &tempfile::TempDir, name: &str) -> String {
        fs::read_to_string(folder.path().join(name)).unwrap()
    }

    fn plan(folder: &tempfile::TempDir, files: &[&str], template: &str) -> RenamePlan {
        let paths: Vec<String> = files.iter().map(|name| path(folder, name)).collect();
        plan_rename(&paths, template, &[]).unwrap()
    }

    fn rename(folder: &tempfile::TempDir, files: &[&str], template: &str) {
        let plan = plan(folder, files, template);
        assert_eq!(plan.preview.clash_count, 0, "{:?}", plan.preview.items);
        apply_plan(&plan).unwrap();
    }

    #[test]
    fn every_sidecar_moves_with_its_photo() {
        let folder = folder_with(&[
            "IMG_1.CR3",
            "IMG_1.CR3.tirdata",
            "IMG_1.CR3.a1b2c3.tirdata",
            "IMG_1.CR3.xmp",
            "IMG_1.xmp",
            "IMG_10.CR3",
            "IMG_10.CR3.tirdata",
        ]);
        rename(&folder, &["IMG_1.CR3"], "trip_{original_filename_number}");
        assert_eq!(
            names(&folder),
            [
                "IMG_10.CR3",
                "IMG_10.CR3.tirdata",
                "trip_1.CR3",
                "trip_1.CR3.a1b2c3.tirdata",
                "trip_1.CR3.tirdata",
                "trip_1.CR3.xmp",
                "trip_1.xmp",
            ]
        );
        assert_eq!(content(&folder, "trip_1.xmp"), "IMG_1.xmp");
        assert_eq!(
            content(&folder, "trip_1.CR3.a1b2c3.tirdata"),
            "IMG_1.CR3.a1b2c3.tirdata"
        );
    }

    #[test]
    fn a_partner_left_behind_keeps_the_shared_xmp_and_the_renamed_file_gets_a_copy() {
        let folder = folder_with(&["IMG_1.CR3", "IMG_1.JPG", "IMG_1.xmp"]);
        rename(&folder, &["IMG_1.JPG"], "beach");
        assert_eq!(
            names(&folder),
            ["IMG_1.CR3", "IMG_1.xmp", "beach.JPG", "beach.xmp"]
        );
        assert_eq!(content(&folder, "beach.xmp"), "IMG_1.xmp");
    }

    #[test]
    fn a_pair_renamed_together_moves_its_shared_xmp() {
        let folder = folder_with(&["IMG_1.CR3", "IMG_1.JPG", "IMG_1.xmp"]);
        rename(&folder, &["IMG_1.CR3", "IMG_1.JPG"], "beach");
        assert_eq!(names(&folder), ["beach.CR3", "beach.JPG", "beach.xmp"]);

        // With different new stems, the first takes the XMP, the other a copy.
        let folder = folder_with(&["IMG_1.CR3", "IMG_1.JPG", "IMG_1.xmp"]);
        rename(&folder, &["IMG_1.CR3", "IMG_1.JPG"], "beach_{seq}");
        assert_eq!(
            names(&folder),
            ["beach_1.CR3", "beach_1.xmp", "beach_2.JPG", "beach_2.xmp"]
        );
    }

    #[test]
    fn chains_and_case_only_renames_work() {
        let folder = folder_with(&["x1.jpg", "x1.jpg.tirdata", "x2.jpg"]);
        // x1 → x2 and x2 → x3: x2 is free once x1's old x2 has moved away.
        rename(&folder, &["x1.jpg", "x2.jpg"], "x{seq:start=2}");
        assert_eq!(names(&folder), ["x2.jpg", "x2.jpg.tirdata", "x3.jpg"]);
        assert_eq!(content(&folder, "x2.jpg"), "x1.jpg");
        assert_eq!(content(&folder, "x3.jpg"), "x2.jpg");

        rename(&folder, &["x2.jpg"], "{original_filename|upper}");
        assert_eq!(names(&folder), ["X2.jpg", "X2.jpg.tirdata", "x3.jpg"]);
    }

    #[test]
    fn clashes_are_found_before_anything_moves() {
        let folder = folder_with(&[
            "a.jpg",
            "b.jpg",
            "c.jpg",
            "Taken.jpg",
            "orphan.xmp",
            "d.jpg",
        ]);
        let preview = |files: &[&str], template: &str| plan(&folder, files, template).preview;

        let batch = preview(&["a.jpg", "b.jpg"], "same");
        assert_eq!(batch.clash_count, 2);
        assert!(
            batch
                .items
                .iter()
                .all(|i| i.clash == Some(RenameClash::Batch))
        );

        // Case-insensitive, as macOS and Windows compare names.
        let existing = preview(&["c.jpg"], "taken");
        assert_eq!(existing.items[0].clash, Some(RenameClash::ExistingFile));

        // d.jpg would take over orphan.xmp's edits.
        let sidecar = preview(&["d.jpg"], "orphan");
        assert_eq!(sidecar.items[0].clash, Some(RenameClash::ExistingSidecar));

        let unchanged = preview(&["a.jpg"], "{original_filename}");
        assert!(unchanged.items[0].unchanged);
        assert_eq!(unchanged.clash_count, 0);

        assert_eq!(
            names(&folder),
            [
                "Taken.jpg",
                "a.jpg",
                "b.jpg",
                "c.jpg",
                "d.jpg",
                "orphan.xmp"
            ]
        );
    }

    #[test]
    fn a_failure_puts_every_file_back() {
        let folder = folder_with(&["a.jpg", "a.jpg.tirdata", "b.jpg"]);
        let mut late = plan(&folder, &["a.jpg", "b.jpg"], "new_{seq}");
        // A target in a folder that does not exist makes the last move fail.
        let last = late.moves.len() - 1;
        late.moves[last].to = folder.path().join("missing").join("b.jpg");
        assert!(apply_plan(&late).is_err());
        assert_eq!(names(&folder), ["a.jpg", "a.jpg.tirdata", "b.jpg"]);
        assert_eq!(content(&folder, "a.jpg.tirdata"), "a.jpg.tirdata");

        // A failing copy also undoes the moves.
        let folder = folder_with(&["IMG_1.CR3", "IMG_1.JPG", "IMG_1.xmp"]);
        let mut copying = plan(&folder, &["IMG_1.JPG"], "beach");
        copying.copies[0].to = folder.path().join("missing").join("beach.xmp");
        assert!(apply_plan(&copying).is_err());
        assert_eq!(names(&folder), ["IMG_1.CR3", "IMG_1.JPG", "IMG_1.xmp"]);
    }

    #[test]
    fn virtual_copies_rename_their_file_once_and_keep_their_query() {
        let folder = folder_with(&["a.jpg", "a.jpg.abc123.tirdata"]);
        let copy = format!("{}?vc=abc123&name=Warm", path(&folder, "a.jpg"));
        let plan = plan_rename(&[path(&folder, "a.jpg"), copy.clone()], "b", &[]).unwrap();
        assert_eq!(plan.preview.items.len(), 1);
        apply_plan(&plan).unwrap();
        assert_eq!(names(&folder), ["b.jpg", "b.jpg.abc123.tirdata"]);
        assert_eq!(
            renamed_path(&copy, &path_map(&plan.renamed)),
            format!("{}?vc=abc123&name=Warm", path(&folder, "b.jpg"))
        );
    }

    #[test]
    fn the_name_before_the_first_rename_is_remembered_once() {
        let preserved = |folder: &tempfile::TempDir, name: &str| {
            crate::exif_processing::load_sidecar(&folder.path().join(format!("{name}.tirdata")))
                .preserved_file_name
        };
        let folder = folder_with(&["IMG_0042.CR3", "IMG_0042.xmp"]);
        fs::write(
            folder.path().join("IMG_0042.xmp"),
            "<rdf:Description>\n</rdf:Description>",
        )
        .unwrap();

        let first = plan(&folder, &["IMG_0042.CR3"], "beach");
        preserve_original_names(&first.renamed, true).unwrap();
        let first = plan(&folder, &["IMG_0042.CR3"], "beach");
        apply_plan(&first).unwrap();
        assert_eq!(
            preserved(&folder, "beach.CR3").as_deref(),
            Some("IMG_0042.CR3")
        );
        let xmp = content(&folder, "beach.xmp");
        assert!(xmp.contains("<xmpMM:PreservedFileName"));
        assert_eq!(
            extract_xmp_preserved_file_name(&xmp).as_deref(),
            Some("IMG_0042.CR3")
        );

        // A second rename keeps the first original, and the token uses it.
        let second = plan(&folder, &["beach.CR3"], "{original_filename}_again");
        assert_eq!(second.preview.items[0].new_name, "IMG_0042_again.CR3");
        preserve_original_names(&second.renamed, true).unwrap();
        assert_eq!(
            preserved(&folder, "beach.CR3").as_deref(),
            Some("IMG_0042.CR3")
        );

        // A name Bridge or Lightroom recorded in the XMP wins over the current one.
        let folder = folder_with(&["DSC_7.jpg", "DSC_7.xmp"]);
        fs::write(
            folder.path().join("DSC_7.xmp"),
            "<rdf:Description xmpMM:PreservedFileName=\"P1000123.JPG\">\n</rdf:Description>",
        )
        .unwrap();
        let renamed = plan(&folder, &["DSC_7.jpg"], "x").renamed;
        preserve_original_names(&renamed, false).unwrap();
        assert_eq!(
            preserved(&folder, "DSC_7.jpg").as_deref(),
            Some("P1000123.JPG")
        );
    }

    #[test]
    fn missing_values_and_cleaned_names_are_reported() {
        let folder = folder_with(&["a.jpg"]);
        let preview = plan(&folder, &["a.jpg"], "{lens}_x/y_{foo}").preview;
        assert_eq!(preview.items[0].new_name, "_x_y_{foo}.jpg");
        assert_eq!(preview.items[0].missing, ["lens"]);
        assert!(preview.items[0].cleaned);
        assert_eq!(preview.errors.len(), 1);
    }
}

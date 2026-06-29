import json
from pathlib import Path

LOCALES_DIR = Path("./locales")

TRANSLATIONS = {
    "de": {
        "empty": "Noch keine LUTs — importiere welche",
        "import": "Profile importieren",
        "importFailed": "LUTs konnten nicht importiert werden",
        "removeLut": "LUT entfernen"
    },
    "en": {
        "empty": "No LUTs yet — import some",
        "import": "Import profiles",
        "importFailed": "Failed to import LUTs",
        "removeLut": "Remove LUT"
    },
    "es": {
        "empty": "Aún no hay LUTs — importa algunos",
        "import": "Importar perfiles",
        "importFailed": "Error al importar LUTs",
        "removeLut": "Eliminar LUT"
    },
    "fr": {
        "empty": "Pas encore de LUT — importez-en",
        "import": "Importer des profils",
        "importFailed": "Échec de l'importation des LUT",
        "removeLut": "Supprimer la LUT"
    },
    "it": {
        "empty": "Nessuna LUT ancora — importane alcune",
        "import": "Importa profili",
        "importFailed": "Impossibile importare le LUT",
        "removeLut": "Rimuovi LUT"
    },
    "ja": {
        "empty": "LUTはまだありません — インポートしてください",
        "import": "プロファイルをインポート",
        "importFailed": "LUTのインポートに失敗しました",
        "removeLut": "LUTを削除"
    },
    "ko": {
        "empty": "아직 LUT가 없습니다 — 가져오기를 수행하세요",
        "import": "프로필 가져오기",
        "importFailed": "LUT 가져오기 실패",
        "removeLut": "LUT 제거"
    },
    "pl": {
        "empty": "Brak LUT — zaimportuj jakieś",
        "import": "Importuj profile",
        "importFailed": "Nie udało się zaimportować LUT",
        "removeLut": "Usuń LUT"
    },
    "pt": {
        "empty": "Sem LUTs ainda — importe alguns",
        "import": "Importar perfis",
        "importFailed": "Falha ao importar LUTs",
        "removeLut": "Remover LUT"
    },
    "ru": {
        "empty": "Пока нет LUT — импортируйте их",
        "import": "Импорт профилей",
        "importFailed": "Не удалось импортировать LUT",
        "removeLut": "Удалить LUT"
    },
    "zh-CN": {
        "empty": "暂无 LUT — 请导入一些",
        "import": "导入配置文件",
        "importFailed": "导入 LUT 失败",
        "removeLut": "移除 LUT"
    },
    "zh-TW": {
        "empty": "暫無 LUT — 請匯入一些",
        "import": "匯入設定檔",
        "importFailed": "匯入 LUT 失敗",
        "removeLut": "移除 LUT"
    }
}

def sort_dict_recursively(item):
    """Recursively sorts dictionary keys alphabetically."""
    if isinstance(item, dict):
        return {k: sort_dict_recursively(v) for k, v in sorted(item.items())}
    elif isinstance(item, list):
        return [sort_dict_recursively(x) for x in item]
    return item

def update_json_file(file_path: Path, trans: dict):
    if not file_path.exists():
        print(f"Skipping: {file_path.name} (File not found)")
        return

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError:
        print(f"Error parsing JSON in {file_path.name}. Skipping.")
        return

    if "ui" not in data or not isinstance(data["ui"], dict):
        data["ui"] = {}
    if "lut" not in data["ui"] or not isinstance(data["ui"]["lut"], dict):
        data["ui"]["lut"] = {}

    lut_node = data["ui"]["lut"]

    lut_node["empty"] = trans["empty"]
    lut_node["import"] = trans["import"]
    lut_node["importFailed"] = trans["importFailed"]
    lut_node["removeLut"] = trans["removeLut"]

    sorted_data = sort_dict_recursively(data)

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(sorted_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Updated and Sorted: {file_path.name}")

def main():
    if not LOCALES_DIR.exists():
        print(f"Error: Locales directory '{LOCALES_DIR}' does not exist.")
        return

    print("Starting sorted translation updates...")
    for lang, trans in TRANSLATIONS.items():
        file_path = LOCALES_DIR / f"{lang}.json"
        update_json_file(file_path, trans)
    print("Done!")

if __name__ == "__main__":
    main()

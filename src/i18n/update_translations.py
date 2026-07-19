import json
from pathlib import Path

LOCALES_DIR = Path("./locales")

TRANSLATIONS = {
    "de": {
        "culling": {
            "addTagPlaceholder": "Tag hinzufügen...",
            "altCullingPreviewHighRes": "Culling-Vorschau in hoher Auflösung",
            "altThumbnailLoading": "Miniaturansicht wird geladen",
            "aperture": "Blende",
            "cameraSettings": "Kameraeinstellungen",
            "clickThumbnailsHint": "Klicken Sie auf Miniaturansichten in der rechten Seitenleiste, um sie zur Vergleichsansicht hinzuzufügen.",
            "colorLabel": "Farbmarkierung",
            "dimensions": "Abmessungen",
            "editImage": "Bild bearbeiten",
            "focalLength": "Brennweite",
            "iso": "ISO",
            "metadata": "Metadaten",
            "noMetadataAvailable": "Keine Metadaten verfügbar",
            "noTagsAdded": "Keine Tags hinzugefügt",
            "none": "Keine",
            "rateAndLabel": "Bewerten & Markieren",
            "rating": "Bewertung",
            "selectImagesToCompare": "Wählen Sie Bilder zum Vergleichen aus",
            "shutterSpeed": "Verschlusszeit",
            "syncZoomAndPan": "Zoom und Schwenken synchronisieren",
            "tags": "Tags",
            "toggleFit": "1:1 / Einpassen umschalten",
            "vc": "VK"
        }
    },
    "en": {
        "culling": {
            "addTagPlaceholder": "Add tag...",
            "altCullingPreviewHighRes": "Culling Preview High Res",
            "altThumbnailLoading": "Thumbnail Loading",
            "aperture": "Aperture",
            "cameraSettings": "Camera Settings",
            "clickThumbnailsHint": "Click thumbnails in the right sidebar to add them to the comparison view.",
            "colorLabel": "Color Label",
            "dimensions": "Dimensions",
            "editImage": "Edit Image",
            "focalLength": "Focal Length",
            "iso": "ISO",
            "metadata": "Metadata",
            "noMetadataAvailable": "No metadata available",
            "noTagsAdded": "No tags added",
            "none": "None",
            "rateAndLabel": "Rate & Label",
            "rating": "Rating",
            "selectImagesToCompare": "Select images to compare",
            "shutterSpeed": "Shutter Speed",
            "syncZoomAndPan": "Sync Zoom and Pan",
            "tags": "Tags",
            "toggleFit": "Toggle 1:1 / Fit",
            "vc": "VC"
        }
    },
    "es": {
        "culling": {
            "addTagPlaceholder": "Añadir etiqueta...",
            "altCullingPreviewHighRes": "Vista previa de selección en alta resolución",
            "altThumbnailLoading": "Cargando miniatura",
            "aperture": "Apertura",
            "cameraSettings": "Ajustes de cámara",
            "clickThumbnailsHint": "Haz clic en las miniaturas de la barra lateral derecha para añadirlas a la vista de comparación.",
            "colorLabel": "Etiqueta de color",
            "dimensions": "Dimensiones",
            "editImage": "Editar imagen",
            "focalLength": "Distancia focal",
            "iso": "ISO",
            "metadata": "Metadatos",
            "noMetadataAvailable": "No hay metadatos disponibles",
            "noTagsAdded": "No se han añadido etiquetas",
            "none": "Ninguno",
            "rateAndLabel": "Puntuar y Etiquetar",
            "rating": "Puntuación",
            "selectImagesToCompare": "Selecciona imágenes para comparar",
            "shutterSpeed": "Velocidad de obturación",
            "syncZoomAndPan": "Sincronizar zoom y desplazamiento",
            "tags": "Etiquetas",
            "toggleFit": "Alternar 1:1 / Ajustar",
            "vc": "CV"
        }
    },
    "fr": {
        "culling": {
            "addTagPlaceholder": "Ajouter un tag...",
            "altCullingPreviewHighRes": "Aperçu de sélection haute résolution",
            "altThumbnailLoading": "Chargement de la miniature",
            "aperture": "Ouverture",
            "cameraSettings": "Paramètres de l'appareil",
            "clickThumbnailsHint": "Cliquez sur les miniatures dans la barre latérale droite pour les ajouter à la vue de comparaison.",
            "colorLabel": "Étiquette de couleur",
            "dimensions": "Dimensions",
            "editImage": "Modifier l'image",
            "focalLength": "Distance focale",
            "iso": "ISO",
            "metadata": "Métadonnées",
            "noMetadataAvailable": "Aucune métadonnée disponible",
            "noTagsAdded": "Aucun tag ajouté",
            "none": "Aucun",
            "rateAndLabel": "Noter et Étiqueter",
            "rating": "Note",
            "selectImagesToCompare": "Sélectionnez des images à comparer",
            "shutterSpeed:": "Vitesse d'obturation",
            "syncZoomAndPan": "Synchroniser le zoom et le panoramique",
            "tags": "Tags",
            "toggleFit": "Basculer 1:1 / Ajuster",
            "vc": "CV"
        }
    },
    "it": {
        "culling": {
            "addTagPlaceholder": "Aggiungi tag...",
            "altCullingPreviewHighRes": "Anteprima di selezione ad alta risoluzione",
            "altThumbnailLoading": "Caricamento miniatura",
            "aperture": "Apertura",
            "cameraSettings": "Impostazioni fotocamera",
            "clickThumbnailsHint": "Fai clic sulle miniature nella barra laterale destra per aggiungerle alla vista di confronto.",
            "colorLabel": "Etichetta colore",
            "dimensions": "Dimensioni",
            "editImage": "Modifica immagine",
            "focalLength": "Lunghezza focale",
            "iso": "ISO",
            "metadata": "Metadati",
            "noMetadataAvailable": "Nessun metadato disponibile",
            "noTagsAdded": "Nessun tag aggiunto",
            "none": "Nessuno",
            "rateAndLabel": "Valuta ed Etichetta",
            "rating": "Valutazione",
            "selectImagesToCompare": "Seleziona le immagini da confrontare",
            "shutterSpeed": "Tempo di posa",
            "syncZoomAndPan": "Sincronizza zoom e panoramica",
            "tags": "Tag",
            "toggleFit": "Alterna 1:1 / Adatta",
            "vc": "CV"
        }
    },
    "ja": {
        "culling": {
            "addTagPlaceholder": "タグを追加...",
            "altCullingPreviewHighRes": "高解像度選別プレビュー",
            "altThumbnailLoading": "サムネイル読み込み中",
            "aperture": "絞り",
            "cameraSettings": "カメラ設定",
            "clickThumbnailsHint": "右サイドバーのサムネイルをクリックして比較ビューに追加します。",
            "colorLabel": "カラーラベル",
            "dimensions": "寸法",
            "editImage": "画像を編集",
            "focalLength": "焦点距離",
            "iso": "ISO",
            "metadata": "メタデータ",
            "noMetadataAvailable": "メタデータがありません",
            "noTagsAdded": "タグが追加されていません",
            "none": "なし",
            "rateAndLabel": "評価とラベル",
            "rating": "評価",
            "selectImagesToCompare": "比較する画像を選択",
            "shutterSpeed": "シャッタースピード",
            "syncZoomAndPan": "ズームとパンを同期",
            "tags": "タグ",
            "toggleFit": "1:1 / 全体表示の切り替え",
            "vc": "VC"
        }
    },
    "ko": {
        "culling": {
            "addTagPlaceholder": "태그 추가...",
            "altCullingPreviewHighRes": "고해상도 선별 미리보기",
            "altThumbnailLoading": "썸네일 로딩 중",
            "aperture": "조리개",
            "cameraSettings": "카메라 설정",
            "clickThumbnailsHint": "비교 뷰에 추가하려면 오른쪽 사이드바에서 썸네일을 클릭하세요.",
            "colorLabel": "색상 라벨",
            "dimensions": "크기",
            "editImage": "이미지 편집",
            "focalLength": "초점 거리",
            "iso": "ISO",
            "metadata": "메타데이터",
            "noMetadataAvailable": "메타데이터 없음",
            "noTagsAdded": "추가된 태그 없음",
            "none": "없음",
            "rateAndLabel": "평가 및 라벨",
            "rating": "평가",
            "selectImagesToCompare": "비교할 이미지 선택",
            "shutterSpeed": "셔터 속도",
            "syncZoomAndPan": "줌 및 이동 동기화",
            "tags": "태그",
            "toggleFit": "1:1 / 맞춤 전환",
            "vc": "VC"
        }
    },
    "pl": {
        "culling": {
            "addTagPlaceholder": "Dodaj tag...",
            "altCullingPreviewHighRes": "Podgląd selekcji w wysokiej rozdzielczości",
            "altThumbnailLoading": "Ładowanie miniatury",
            "aperture": "Przysłona",
            "cameraSettings": "Ustawienia aparatu",
            "clickThumbnailsHint": "Kliknij miniatury na prawym pasku bocznym, aby dodać je do widoku porównania.",
            "colorLabel": "Etykieta koloru",
            "dimensions": "Wymiary",
            "editImage": "Edytuj obraz",
            "focalLength": "Ogniskowa",
            "iso": "ISO",
            "metadata": "Metadane",
            "noMetadataAvailable": "Brak dostępnych metadanych",
            "noTagsAdded": "Nie dodano tagów",
            "none": "Brak",
            "rateAndLabel": "Oceń i Oznacz",
            "rating": "Ocena",
            "selectImagesToCompare": "Wybierz obrazy do porównania",
            "shutterSpeed": "Czas otwarcia migawki",
            "syncZoomAndPan": "Synchronizuj powiększenie i przesuwanie",
            "tags": "Tagi",
            "toggleFit": "Przełącz 1:1 / Dopasuj",
            "vc": "KW"
        }
    },
    "pt": {
        "culling": {
            "addTagPlaceholder": "Adicionar tag...",
            "altCullingPreviewHighRes": "Visualização de seleção em alta resolução",
            "altThumbnailLoading": "Carregando miniatura",
            "aperture": "Abertura",
            "cameraSettings": "Configurações da câmera",
            "clickThumbnailsHint": "Clique nas miniaturas na barra lateral direita para adicioná-las à visualização de comparação.",
            "colorLabel": "Rótulo de cor",
            "dimensions": "Dimensões",
            "editImage": "Editar imagem",
            "focalLength": "Distância focal",
            "iso": "ISO",
            "metadata": "Metadados",
            "noMetadataAvailable": "Nenhum metadado disponível",
            "noTagsAdded": "Nenhuma tag adicionada",
            "none": "Nenhum",
            "rateAndLabel": "Avaliar e Rotular",
            "rating": "Avaliação",
            "selectImagesToCompare": "Selecione imagens para comparar",
            "shutterSpeed": "Velocidade do obturador",
            "syncZoomAndPan": "Sincronizar zoom e deslocamento",
            "tags": "Tags",
            "toggleFit": "Alternar 1:1 / Ajustar",
            "vc": "CV"
        }
    },
    "ru": {
        "culling": {
            "addTagPlaceholder": "Добавить тег...",
            "altCullingPreviewHighRes": "Предпросмотр отбора в высоком разрешении",
            "altThumbnailLoading": "Загрузка миниатюры",
            "aperture": "Диафрагма",
            "cameraSettings": "Настройки камеры",
            "clickThumbnailsHint": "Нажмите на миниатюры на правой боковой панели, чтобы добавить их в режим сравнения.",
            "colorLabel": "Цветовая метка",
            "dimensions": "Размеры",
            "editImage": "Редактировать изображение",
            "focalLength": "Фокусное расстояние",
            "iso": "ISO",
            "metadata": "Метаданные",
            "noMetadataAvailable": "Метаданные недоступны",
            "noTagsAdded": "Теги не добавлены",
            "none": "Нет",
            "rateAndLabel": "Оценка и метка",
            "rating": "Оценка",
            "selectImagesToCompare": "Выберите изображения для сравнения",
            "shutterSpeed": "Выдержка",
            "syncZoomAndPan": "Синхронизировать масштаб и панорамирование",
            "tags": "Теги",
            "toggleFit": "Переключить 1:1 / Вписать",
            "vc": "ВК"
        }
    },
    "zh-CN": {
        "culling": {
            "addTagPlaceholder": "添加标签...",
            "altCullingPreviewHighRes": "高分辨率筛选预览",
            "altThumbnailLoading": "缩略图加载中",
            "aperture": "光圈",
            "cameraSettings": "相机设置",
            "clickThumbnailsHint": "在右侧边栏中单击缩略图以将它们添加到比较视图中。",
            "colorLabel": "颜色标签",
            "dimensions": "尺寸",
            "editImage": "编辑图像",
            "focalLength": "焦距",
            "iso": "ISO",
            "metadata": "元数据",
            "noMetadataAvailable": "无可用元数据",
            "noTagsAdded": "未添加标签",
            "none": "无",
            "rateAndLabel": "评分与标签",
            "rating": "评分",
            "selectImagesToCompare": "选择要比较的图像",
            "shutterSpeed": "快门速度",
            "syncZoomAndPan": "同步缩放和平移",
            "tags": "标签",
            "toggleFit": "切换 1:1 / 适应",
            "vc": "VC"
        }
    },
    "zh-TW": {
        "culling": {
            "addTagPlaceholder": "新增標籤...",
            "altCullingPreviewHighRes": "高解析度篩選預覽",
            "altThumbnailLoading": "縮圖載入中",
            "aperture": "光圈",
            "cameraSettings": "相機設定",
            "clickThumbnailsHint": "按一下右側邊欄中的縮圖，將其新增至比較檢視中。",
            "colorLabel": "顏色標籤",
            "dimensions": "尺寸",
            "editImage": "編輯影像",
            "focalLength": "焦距",
            "iso": "ISO",
            "metadata": "中繼資料",
            "noMetadataAvailable": "無可用中繼資料",
            "noTagsAdded": "未新增標籤",
            "none": "無",
            "rateAndLabel": "評分與標籤",
            "rating": "評分",
            "selectImagesToCompare": "選擇要比較的影像",
            "shutterSpeed": "快門速度",
            "syncZoomAndPan": "同步縮放與平移",
            "tags": "標籤",
            "toggleFit": "切換 1:1 / 適應",
            "vc": "VC"
        }
    }
}

def sort_dict_recursively(item):
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

    # library -> culling node
    library_node = data.setdefault("library", {})
    culling_node = library_node.setdefault("culling", {})

    for key, value in trans["culling"].items():
        culling_node[key] = value

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

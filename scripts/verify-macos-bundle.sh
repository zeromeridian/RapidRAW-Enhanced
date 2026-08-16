#!/bin/bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/ThisIsRAW.app" >&2
  exit 2
fi

app_path=$1
executable_path="$app_path/Contents/MacOS/ThisIsRAW"
onnx_path="$app_path/Contents/Resources/resources/libonnxruntime.dylib"

for required_path in "$app_path" "$executable_path" "$onnx_path"; do
  if [[ ! -e "$required_path" ]]; then
    echo "required bundle path is missing: $required_path" >&2
    exit 1
  fi
done

onnx_id=$(otool -D "$onnx_path" | sed -n '2p' | xargs)
if [[ ! "$onnx_id" =~ ^@rpath/libonnxruntime.*\.dylib$ ]]; then
  echo "unexpected ONNX Runtime install name: $onnx_id" >&2
  exit 1
fi

while IFS= read -r -d '' candidate; do
  if ! file -b "$candidate" | grep -q 'Mach-O'; then
    continue
  fi

  dependencies=$(otool -L "$candidate")
  echo "$dependencies"

  while IFS= read -r dependency; do
    case "$dependency" in
      @*|/System/*|/usr/lib/*) ;;
      *)
        echo "non-portable dependency in $candidate: $dependency" >&2
        exit 1
        ;;
    esac
  done < <(echo "$dependencies" | tail -n +2 | awk '{ print $1 }')
done < <(find "$app_path" -type f -print0)

signature_details=$(codesign -dvv "$app_path" 2>&1 || true)
if echo "$signature_details" | grep -q '^Authority='; then
  codesign --verify --deep --strict --verbose=2 "$app_path"
  spctl --assess --type execute --verbose=4 "$app_path"
elif [[ "${REQUIRE_APPLE_SIGNATURE:-false}" == "true" ]]; then
  echo "release bundle is not signed with an Apple Developer ID" >&2
  exit 1
fi

echo "macOS bundle verification passed: $app_path"

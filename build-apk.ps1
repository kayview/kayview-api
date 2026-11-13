# KAYVIEW CHARGER - Flutter APK Builder - PowerShell
Write-Host "=== KAYVIEW CHARGER APK - Flutter ===" -ForegroundColor Cyan

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  Write-Host "Flutter not found! Install from https://flutter.dev" -ForegroundColor Red
  exit 1
}

Write-Host "Flutter found" -ForegroundColor Green
flutter pub get

Write-Host "Building APK..." -ForegroundColor Yellow
flutter build apk --release

Write-Host "APK built at build/app/outputs/flutter-apk/app-release.apk" -ForegroundColor Green

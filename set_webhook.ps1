Write-Host "=== FrodRobot: установка Telegram webhook ===" -ForegroundColor Cyan
$BOT_TOKEN = Read-Host "1) Вставь BOT_TOKEN от @BotFather"
$BASE_URL = Read-Host "2) Вставь адрес Render без /webhook (пример: https://frodrobot.onrender.com)"
$SECRET = Read-Host "3) Вставь тот же SECRET_TOKEN, который указал в Render"

$BASE_URL = $BASE_URL.TrimEnd('/')
$URL = "$BASE_URL/webhook"
$ALLOWED='["message","edited_message","business_connection","business_message","edited_business_message","deleted_business_messages"]'

Write-Host "`nУстанавливаю webhook..." -ForegroundColor Yellow
curl.exe -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" `
  --data-urlencode "url=$URL" `
  --data-urlencode "secret_token=$SECRET" `
  --data-urlencode "allowed_updates=$ALLOWED"

Write-Host "`n`nПроверяю webhook..." -ForegroundColor Yellow
Invoke-RestMethod "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo" | ConvertTo-Json -Depth 6
Write-Host "`nЕсли видишь URL своего Render и last_error_message пустой — всё готово." -ForegroundColor Green

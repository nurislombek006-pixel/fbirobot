# FrodRobot v2 — быстрый Web Chat

Бот сохраняет Telegram Business-сообщения в PostgreSQL и показывает их в веб-интерфейсе.

## Что улучшено в v2

- Чат больше не скачивает до 3000 сообщений каждые 2.5 секунды.
- При открытии загружаются только последние 80 сообщений.
- Новые/изменённые/удалённые сообщения приходят маленькими обновлениями.
- Старые сообщения загружаются кнопкой «Загрузить старые».
- Медиа больше не пересоздаётся каждые несколько секунд.
- Список чатов обновляется реже и использует более лёгкие SQL-запросы.
- Добавлены дополнительные индексы PostgreSQL.
- Новый более компактный интерфейс для телефона и компьютера.
- На главной есть простая форма входа по VIEWER_KEY.
- Отчёт о новом сообщении владельцу отправляется асинхронно и не задерживает webhook.

## Переменные окружения

BOT_TOKEN=токен Telegram-бота
OWNER_ID=ваш Telegram ID
SECRET_TOKEN=случайный секрет для Telegram webhook
VIEWER_KEY=пароль для веб-страницы
DATABASE_URL=строка подключения Neon PostgreSQL
MAX_MESSAGES_PER_DIALOG=3000
REPORT_MESSAGES=1

Если не хотите получать владельцу копию каждого нового сообщения, поставьте REPORT_MESSAGES=0.

## Render

Build Command:

npm install

Start Command:

npm start

После деплоя откройте:

https://ВАШ-СЕРВИС.onrender.com

Введите VIEWER_KEY и нажмите «Открыть чаты».

## Установка webhook в Windows PowerShell

Замените значения на свои:

$BOT_TOKEN="ВАШ_BOT_TOKEN"
$URL="https://ВАШ-СЕРВИС.onrender.com/webhook"
$SECRET="ВАШ_SECRET_TOKEN"
$ALLOWED='["message","edited_message","business_connection","business_message","edited_business_message","deleted_business_messages"]'

curl.exe -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" --data-urlencode "url=$URL" --data-urlencode "secret_token=$SECRET" --data-urlencode "allowed_updates=$ALLOWED"

Если Telegram вернул `"ok":true`, webhook установлен.

## Проверка webhook

$BOT_TOKEN="ВАШ_BOT_TOKEN"
curl.exe "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"

Ищите URL вашего Render-сервиса и отсутствие ошибок в `last_error_message`.

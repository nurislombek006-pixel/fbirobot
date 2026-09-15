import express from 'express';
import { Pool } from 'pg';

const app = express();
app.use(express.json({ limit: '25mb' }));
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OWNER_ID = String(process.env.OWNER_ID || '');
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'my_secret_123';
const VIEWER_KEY = process.env.VIEWER_KEY || SECRET_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL || '';
const MAX = Number(process.env.MAX_MESSAGES_PER_DIALOG || 3000);
const REPORT_MESSAGES = String(process.env.REPORT_MESSAGES || '1') !== '0';

const pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL ? { rejectUnauthorized:false } : false, max: 6 });
let ready = initDb();
async function initDb(){
  if(!DATABASE_URL) { console.log('DATABASE_URL missing'); return; }
  await pool.query(`CREATE TABLE IF NOT EXISTS business_connections(id text primary key,is_enabled boolean,user_id text,user_name text,user_short text,user_chat_id text,date_ts bigint,rights jsonb,saved_at bigint);`);
  await pool.query(`CREATE TABLE IF NOT EXISTS dialogs(id text primary key,short_id text unique,business_connection_id text,chat_id text,title text,short_title text,owner jsonb,peer jsonb,notified boolean default false,created_at bigint,updated_at bigint);`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(dialog_id text not null,message_id text not null,side text,from_id text,author text,author_full text,to_id text,to_name text,text text,plain text,date_ts bigint,time_text text,edited boolean default false,edit_date bigint,old_text text,deleted boolean default false,media jsonb,reply jsonb,raw_type text,saved_at bigint,primary key(dialog_id,message_id));`);
  await pool.query(`CREATE TABLE IF NOT EXISTS restored_media_events(event_key text primary key, created_at bigint);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dialogs_updated ON dialogs(updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_message ON messages(message_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_dialog ON messages(dialog_id,date_ts,message_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_saved ON messages(dialog_id,saved_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_dialog_latest ON messages(dialog_id,date_ts DESC,message_id);`);
  console.log('✅ Database ready');
}
async function q(sql,p=[]){ await ready; return pool.query(sql,p); }
function esc(s){return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}
function attr(s){return esc(s).replaceAll('"','&quot;')}
function json(res,d,st=200){return res.status(st).set('Cache-Control','no-store').json(d)}
function html(res,t,st=200){return res.status(st).set('Content-Type','text/html; charset=utf-8').set('Cache-Control','no-store').send(t)}
function now(){return Date.now()} function unix(){return Math.floor(Date.now()/1000)}
function line(){return '━━━━━━━━━━━━━━'}
function fmt(ts){ if(!ts) return 'неизвестно'; return new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(Number(ts)*1000)).replace(',',' •') }
function fmtNow(){ return new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date()).replace(',',' •') }
function origin(req){return `${req.headers['x-forwarded-proto']||req.protocol||'https'}://${req.headers['x-forwarded-host']||req.headers.host}`}
function okKey(req){return req.query.key && String(req.query.key)===String(VIEWER_KEY)}
async function tg(method,payload){ const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const t=await r.text(); if(!r.ok) console.log('TG error',method,r.status,t); try{return JSON.parse(t)}catch{return{ok:false,raw:t}} }
async function send(chat_id,text){ if(!chat_id) return; return tg('sendMessage',{chat_id,text:String(text).slice(0,3900),parse_mode:'HTML',disable_web_page_preview:true}) }
async function owner(text){ if(OWNER_ID) return send(OWNER_ID,text) }
function uname(u){ if(!u) return 'unknown'; let n=[u.first_name,u.last_name].filter(Boolean).join(' '); if(u.username) n+=` (@${u.username})`; return n || String(u.id||'unknown') }
function shortUser(u){ if(!u) return 'unknown'; if(u.username) return `@${u.username}`; const n=[u.first_name,u.last_name].filter(Boolean).join(' '); return n ? `${n} (ID:${u.id||'unknown'})` : `ID:${u.id||'unknown'}` }
function cname(c){ if(!c) return 'unknown'; let n=c.title || [c.first_name,c.last_name].filter(Boolean).join(' '); if(c.username) n+=` (@${c.username})`; return n || String(c.id||'unknown') }
function shortChat(c){ if(!c) return 'unknown'; if(c.username) return `@${c.username}`; const n=c.title || [c.first_name,c.last_name].filter(Boolean).join(' '); return n ? `${n} (ID:${c.id||'unknown'})` : `ID:${c.id||'unknown'}` }
function fallbackOwner(){return 'Business аккаунт'}
function isPrivate(c){return c&&c.type==='private'}
function isBusiness(m){return Boolean(m.business_connection_id)}
function textOf(m){ if(m.text) return m.text; if(m.caption) return m.caption; if(m.photo) return '[🖼 фото]'; if(m.video) return '[🎬 видео]'; if(m.document) return `[📄 документ / файл${m.document.file_name?': '+m.document.file_name:''}]`; if(m.voice) return '[🎤 голосовое сообщение]'; if(m.video_note) return '[⭕ видеосообщение / кружочек]'; if(m.sticker) return `[🌟 стикер${m.sticker.emoji?' '+m.sticker.emoji:''}]`; if(m.animation) return '[🎞 GIF / анимация]'; if(m.audio) return '[🎧 аудио]'; return '[сообщение без текста]' }
function mediaOf(m){
  if(m.photo?.length){let x=m.photo[m.photo.length-1];return{type:'photo',file_id:x.file_id,label:'Фото',file_name:'',mime_type:'image/jpeg'}}
  if(m.video?.file_id)return{type:'video',file_id:m.video.file_id,label:'Видео',file_name:m.video.file_name||'',mime_type:m.video.mime_type||'video/mp4'};
  if(m.document?.file_id)return{type:'document',file_id:m.document.file_id,label:'Документ',file_name:m.document.file_name||'',mime_type:m.document.mime_type||''};
  if(m.animation?.file_id)return{type:'animation',file_id:m.animation.file_id,label:'GIF',file_name:m.animation.file_name||'',mime_type:m.animation.mime_type||'video/mp4'};
  if(m.audio?.file_id)return{type:'audio',file_id:m.audio.file_id,label:'Аудио',file_name:m.audio.file_name||m.audio.title||'',mime_type:m.audio.mime_type||'audio/mpeg'};
  if(m.voice?.file_id)return{type:'voice',file_id:m.voice.file_id,label:'Голосовое',file_name:'',mime_type:m.voice.mime_type||'audio/ogg'};
  if(m.video_note?.file_id)return{type:'video_note',file_id:m.video_note.file_id,label:'Кружок',file_name:'',mime_type:'video/mp4'};
  if(m.sticker?.file_id)return{type:'sticker',file_id:m.sticker.file_id,label:`Стикер${m.sticker.emoji?' '+m.sticker.emoji:''}`,file_name:'',mime_type:m.sticker.is_animated?'application/x-tgsticker':'image/webp'};
  return null;
}
function replyOf(m){return m.reply_to_message?{message_id:m.reply_to_message.message_id||null,author:shortUser(m.reply_to_message.from),text:textOf(m.reply_to_message)}:null}
function did(m){return `${m.business_connection_id||'normal'}:${m.chat?.id||'unknown_chat'}`}
function sid(){return Math.random().toString(36).slice(2,6)+Date.now().toString(36).slice(-4)}
async function saveConn(c){ const u=c.user||{}; await q(`insert into business_connections(id,is_enabled,user_id,user_name,user_short,user_chat_id,date_ts,rights,saved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(id) do update set is_enabled=excluded.is_enabled,user_id=excluded.user_id,user_name=excluded.user_name,user_short=excluded.user_short,user_chat_id=excluded.user_chat_id,date_ts=excluded.date_ts,rights=excluded.rights,saved_at=excluded.saved_at`,[c.id,!!c.is_enabled,String(u.id||''),uname(u),shortUser(u),String(c.user_chat_id||''),c.date||null,JSON.stringify(c.rights||null),now()]) }
async function getOwner(connectionId){ if(!connectionId)return null; let r=await q('select * from business_connections where id=$1',[connectionId]); if(!r.rows[0]){ const g=await tg('getBusinessConnection',{business_connection_id:connectionId}); if(g?.ok&&g.result){ await saveConn(g.result); r=await q('select * from business_connections where id=$1',[connectionId]); } } const x=r.rows[0]; if(!x)return null; return{id:x.user_id||'',name:x.user_name||fallbackOwner(),shortName:x.user_short||x.user_name||fallbackOwner(),chatId:x.user_chat_id||''} }
async function dirOf(m){ const chat=m.chat||{}, sender=m.from||{}; const sName=uname(sender), sShort=shortUser(sender), sId=String(sender.id||''); const chName=cname(chat), chShort=shortChat(chat), chId=String(chat.id||''); if(isBusiness(m)){ const o=await getOwner(m.business_connection_id); const oName=o?.name||fallbackOwner(), oShort=o?.shortName||fallbackOwner(), oId=String(o?.id||''); if(isPrivate(chat)&&sender.id&&chat.id&&String(sender.id)===String(chat.id)){return{side:'left',from:sName,fromShort:sShort,fromId:sId,to:oName,toShort:oShort,toId:oId,dialog:`${oName} ↔ ${chName}`,dialogShort:`${oShort} ↔ ${chShort}`}} if(isPrivate(chat)){return{side:'right',from:sName,fromShort:oShort,fromId:sId,to:chName,toShort:chShort,toId:chId,dialog:`${oName} ↔ ${chName}`,dialogShort:`${oShort} ↔ ${chShort}`}} }
 return{side:'left',from:sName,fromShort:sShort,fromId:sId,to:chName,toShort:chShort,toId:chId,dialog:chName,dialogShort:chShort} }
async function dialogMeta(id){ const r=await q('select * from dialogs where id=$1',[id]); const x=r.rows[0]; if(!x)return null; return{id:x.id,short_id:x.short_id,business_connection_id:x.business_connection_id,chat_id:x.chat_id,title:x.title,shortTitle:x.short_title,owner:x.owner||{},peer:x.peer||{},notified:x.notified,created_at:Number(x.created_at||0),updated_at:Number(x.updated_at||0)} }
async function upDialog(d){ await q(`insert into dialogs(id,short_id,business_connection_id,chat_id,title,short_title,owner,peer,notified,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(id) do update set short_id=excluded.short_id,business_connection_id=excluded.business_connection_id,chat_id=excluded.chat_id,title=excluded.title,short_title=excluded.short_title,owner=excluded.owner,peer=excluded.peer,notified=excluded.notified,updated_at=excluded.updated_at`,[d.id,d.short_id,d.business_connection_id,String(d.chat_id||''),d.title,d.shortTitle,JSON.stringify(d.owner||{}),JSON.stringify(d.peer||{}),!!d.notified,d.created_at||now(),d.updated_at||now()]) }
async function getOrCreateDialog(m,dir){ const id=did(m); let d=await dialogMeta(id); if(!d){ d={id,short_id:sid(),business_connection_id:m.business_connection_id||null,chat_id:String(m.chat?.id||''),title:dir.dialog,shortTitle:dir.dialogShort,owner:{id:dir.toId||'',name:dir.to||'',short:dir.toShort||''},peer:{id:String(m.chat?.id||''),name:cname(m.chat),short:shortChat(m.chat)},notified:false,created_at:now(),updated_at:now()}; await upDialog(d); } return d }
function buildMsg(m,dir){ const media=mediaOf(m); return{dialog_id:did(m),message_id:String(m.message_id||''),side:dir.side||'left',from_id:String(dir.fromId||m.from?.id||''),author:dir.fromShort||dir.from||'unknown',author_full:dir.from||'unknown',to_id:String(dir.toId||''),to_name:dir.to||'',text:m.text||m.caption||'',plain:textOf(m),date_ts:m.date||null,time_text:fmt(m.date),edited:false,edit_date:null,old_text:'',deleted:false,media,reply:replyOf(m),raw_type:media?media.type:'text',saved_at:now()} }
async function upMsg(x){ await q(`insert into messages(dialog_id,message_id,side,from_id,author,author_full,to_id,to_name,text,plain,date_ts,time_text,edited,edit_date,old_text,deleted,media,reply,raw_type,saved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) on conflict(dialog_id,message_id) do update set side=excluded.side,from_id=excluded.from_id,author=excluded.author,author_full=excluded.author_full,to_id=excluded.to_id,to_name=excluded.to_name,text=excluded.text,plain=excluded.plain,date_ts=excluded.date_ts,time_text=excluded.time_text,media=excluded.media,reply=excluded.reply,raw_type=excluded.raw_type,saved_at=excluded.saved_at`,[x.dialog_id,x.message_id,x.side,x.from_id,x.author,x.author_full,x.to_id,x.to_name,x.text,x.plain,x.date_ts,x.time_text,!!x.edited,x.edit_date,x.old_text,!!x.deleted,JSON.stringify(x.media||null),JSON.stringify(x.reply||null),x.raw_type,x.saved_at]) }
function rowMsg(r){return{id:String(r.message_id||''),message_id:r.message_id,side:r.side,from_id:r.from_id,author:r.author||'unknown',author_full:r.author_full||r.author||'unknown',to_id:r.to_id,to:r.to_name,text:r.text||'',plain:r.plain||'',date:r.date_ts?Number(r.date_ts):null,timeText:r.time_text||'',edited:!!r.edited,edit_date:r.edit_date?Number(r.edit_date):null,old_text:r.old_text||'',deleted:!!r.deleted,media:r.media||null,reply:r.reply||null,raw_type:r.raw_type||'text',saved_at:r.saved_at?Number(r.saved_at):null}}
async function getMsg(dialogId,messageId){ const r=await q('select * from messages where dialog_id=$1 and message_id=$2',[dialogId,String(messageId)]); return r.rows[0]?rowMsg(r.rows[0]):null }

async function restoreRepliedMedia(m){
  try{
    const reply=m.reply_to_message;
    if(!reply?.message_id)return;

    const replyChatId=reply.chat?.id || m.chat?.id;
    if(!replyChatId)return;

    const dialogId=`${m.business_connection_id||'normal'}:${replyChatId}`;
    const responderId=String(m.from?.id||'unknown');
    const responderName=uname(m.from)||shortUser(m.from)||`ID:${responderId}`;
    const eventKey=`${dialogId}:${reply.message_id}:${responderId}`;

    await q(`delete from restored_media_events where created_at < $1`,[now()-7*24*60*60*1000]);

    const inserted=await q(
      `insert into restored_media_events(event_key,created_at)
       values($1,$2)
       on conflict(event_key) do nothing
       returning event_key`,
      [eventKey,now()]
    );

    if(inserted.rowCount===0)return;

    const saved=await getMsg(dialogId,String(reply.message_id));
    let media=saved?.media || mediaOf(reply);
    if(!media?.file_id)return;

    const allowed=['photo','video','video_note','document'];
    if(!allowed.includes(media.type))return;

    const isOneTime=Boolean(
      reply.ttl_seconds ||
      media.original_file_id ||
      media.original_type ||
      String(media.label||'').toLowerCase().includes('однораз') ||
      String(saved?.plain||'').toLowerCase().includes('однораз')
    );
    if(!isOneTime)return;

    const target=m.from?.id;
    if(!target)return;

    const originalAuthor=saved?.author_full || saved?.author || shortUser(reply.from) || 'неизвестно';
    const originalTime=saved?.timeText || fmt(saved?.date || reply.date);
    const originalId=saved?.message_id || reply.message_id;

    const caption=
      `🔄 <b>Одноразовое медиа восстановлено</b>\n`+
      `${line()}\n`+
      `Ты ответил на одноразовое фото/видео. Бот сохранил копию и попытался отправить её тебе.\n\n`+
      `📎 <b>${esc(media.label||'Медиа')}</b>\n`+
      `🧾 Media ID: <code>${esc(originalId||'')}</code>\n`+
      `👤 От: ${esc(originalAuthor)}\n`+
      `🕘 ${esc(originalTime||'')}`;

    const result=await sendRecoveredMediaToTarget(target,media,caption);
    const friendlyReason=!result?.ok?deliveryFailureReason(result):'';

    if(OWNER_ID && String(OWNER_ID)!==String(target)){
      const ownerCaption=result?.ok
        ? `👁 <b>Ответ на одноразовое сообщение</b>\n${line()}\n${esc(responderName)} ответил на одноразовое медиа. Копия успешно отправлена пользователю.\n\n📎 <b>${esc(media.label||'Медиа')}</b>\n🧾 Media ID: <code>${esc(originalId||'')}</code>\n🕘 ${esc(originalTime||'')}`
        : friendlyReason
          ? `ℹ️ <b>Ответ на одноразовое сообщение</b>\n${line()}\n${esc(responderName)} ответил на одноразовое фото/видео, но я не смог отправить ему сохранённую копию.\n\n<b>Почему:</b> ${esc(friendlyReason)}\n\nЭто не ошибка сохранения — ответ и переписка продолжат отображаться в Web-чате.\n\n📎 Media ID: <code>${esc(originalId||'')}</code>`
          : `⚠️ <b>Ответ на одноразовое сообщение</b>\n${line()}\n${esc(responderName)} ответил на одноразовое медиа, но отправить копию не получилось.\n\n📎 Media ID: <code>${esc(originalId||'')}</code>\n<code>${esc(JSON.stringify(result||{})).slice(0,1000)}</code>`;

      const ownerResult=await sendRecoveredMediaToTarget(OWNER_ID,media,ownerCaption);
      if(!ownerResult?.ok){
        await owner(`⚠️ <b>Не удалось отправить владельцу копию одноразового медиа</b>\n\nMedia ID: <code>${esc(originalId||'')}</code>`);
      }
    }
  }catch(e){
    console.error('restoreRepliedMedia error:',e);
    if(OWNER_ID)await owner(`⚠️ <b>Ошибка обработки ответа на одноразовое сообщение</b>\n\n<code>${esc(String(e)).slice(0,1000)}</code>`);
  }
}
async function trim(dialogId){ await q(`delete from messages where dialog_id=$1 and ctid in (select ctid from messages where dialog_id=$1 order by coalesce(date_ts,0) desc, message_id::bigint desc offset $2)`,[dialogId,MAX]) }
async function onMessage(req,m){ const dir=await dirOf(m); if(m.reply_to_message) restoreRepliedMedia(m).catch(e=>console.error('restoreRepliedMedia async error:',e)); const d=await getOrCreateDialog(m,dir); let stored=buildMsg(m,dir); stored=await cacheSelfDestructMediaIfNeeded(m,stored); await upMsg(stored); d.updated_at=now(); await upDialog(d); await trim(d.id); await notify(req,d); reportNewMessage(d,stored).catch(e=>console.error('reportNewMessage async error:',e)) }
async function oldMsg(dialogId,messageId){ const d=await dialogMeta(dialogId); const m=await getMsg(dialogId,messageId); if(!m)return null; return{text:m.text||m.plain||'',from_id:m.from_id,from_name:m.author_full,from_short:m.author,to_id:d?.owner?.id||'',to_name:d?.owner?.name||'',to_short:d?.owner?.short||'',dialog_name:d?.title||'',dialog_short:d?.shortTitle||'',message_id:m.message_id,date:m.date} }
async function onEdit(req,m){ const dir=await dirOf(m); const d=await getOrCreateDialog(m,dir); const old=await oldMsg(d.id,String(m.message_id||'')); const cur=buildMsg(m,dir); const newText=m.text||m.caption||textOf(m); await q(`insert into messages(dialog_id,message_id,side,from_id,author,author_full,to_id,to_name,text,plain,date_ts,time_text,edited,edit_date,old_text,deleted,media,reply,raw_type,saved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,false,$15,$16,$17,$18) on conflict(dialog_id,message_id) do update set text=excluded.text,plain=excluded.plain,edited=true,edit_date=excluded.edit_date,old_text=case when messages.old_text is null or messages.old_text='' then excluded.old_text else messages.old_text end,time_text=excluded.time_text,media=excluded.media,reply=excluded.reply,saved_at=excluded.saved_at`,[cur.dialog_id,cur.message_id,cur.side,cur.from_id,cur.author,cur.author_full,cur.to_id,cur.to_name,newText,textOf(m),cur.date_ts,fmt(m.edit_date||m.date),m.edit_date||m.date,old?.text||'',JSON.stringify(cur.media||null),JSON.stringify(cur.reply||null),cur.raw_type,now()]); d.updated_at=now(); await upDialog(d); await notify(req,d); await sendChanged(m.business_connection_id, makeEditReport(m,old,dir)); }
async function sendChanged(conn,text){ if(!conn)return; const o=await getOwner(conn); if(o?.chatId&&String(o.chatId)!==OWNER_ID) await send(o.chatId,text) }
function makeEditReport(m,old,dir){ const nt=textOf(m); const mid=m.message_id||''; return `✏️ <b>ИЗМЕНЕНО СООБЩЕНИЕ</b>\n${line()}\n\nОт: <b>${esc(dir.from)}</b>\nID: <code>${esc(dir.fromId||'')}</code>\n\nКому: <b>${esc(dir.to)}</b>\nMsg ID: <code>${esc(mid)}</code>\nВремя: <code>${esc(fmt(m.edit_date||m.date))}</code>\n\n${old?`<b>Было:</b>\n<blockquote>${esc(old.text||'[пусто]')}</blockquote>\n<b>Стало:</b>\n<blockquote>${esc(nt||'[пусто]')}</blockquote>`:`⚠️ Старый текст не найден.\n\n<b>Сейчас:</b>\n<blockquote>${esc(nt||'[пусто]')}</blockquote>`}` }
async function onDelete(req,data){ const conn=data.business_connection_id||'normal', chatId=data.chat?.id||'unknown_chat', dialogId=`${conn}:${chatId}`, o=await getOwner(conn), ids=data.message_ids||[]; let last=null, reps=[]; for(const mid of ids.slice(0,50)){ const old=await oldMsg(dialogId,String(mid)); last=await dialogMeta(dialogId); if(!last){last={id:dialogId,short_id:sid(),business_connection_id:data.business_connection_id||null,chat_id:String(chatId),title:`${o?.name||fallbackOwner()} ↔ ${cname(data.chat)}`,shortTitle:`${o?.shortName||fallbackOwner()} ↔ ${shortChat(data.chat)}`,owner:{id:o?.id||'',name:o?.name||fallbackOwner(),short:o?.shortName||fallbackOwner()},peer:{id:String(chatId),name:cname(data.chat),short:shortChat(data.chat)},notified:false,created_at:now(),updated_at:now()}}
   const ex=await getMsg(dialogId,String(mid)); if(ex){ await q(`update messages set deleted=true,text=case when text='' or text is null then $3 else text end,plain=case when plain='' or plain is null then $3 else plain end,time_text=$4,saved_at=$5 where dialog_id=$1 and message_id=$2`,[dialogId,String(mid),old?.text||ex.text||ex.plain||'[сообщение удалено]',fmtNow(),now()]); } else { await q(`insert into messages(dialog_id,message_id,side,from_id,author,author_full,to_id,to_name,text,plain,date_ts,time_text,edited,old_text,deleted,raw_type,saved_at) values($1,$2,'left',$3,$4,$5,$6,$7,$8,$8,$9,$10,false,'',true,'deleted',$11) on conflict(dialog_id,message_id) do update set deleted=true`,[dialogId,String(mid),old?.from_id||'',old?.from_short||'unknown',old?.from_name||'unknown',old?.to_id||o?.id||'',old?.to_name||o?.name||'',old?.text||'[сообщение удалено]',old?.date||unix(),fmtNow(),now()]); }
   last.updated_at=now(); await upDialog(last); reps.push(makeDelReport(old,mid,o)); }
 if(last) await notify(req,last); const chunks=split(reps); for(const ch of chunks.slice(0,2)) await sendChanged(data.business_connection_id,ch); }
function makeDelReport(old,id,o){ if(old)return `🗑️ <b>УДАЛЕНО СООБЩЕНИЕ</b>\n${line()}\n\nОт: <b>${esc(old.from_name||'unknown')}</b>\nID: <code>${esc(old.from_id||'')}</code>\n\nКому: <b>${esc(old.to_name||fallbackOwner())}</b>\nMsg ID: <code>${esc(id||old.message_id||'')}</code>\nВремя: <code>${esc(fmtNow())}</code>\n\n<b>Содержимое:</b>\n<blockquote>${esc(old.text||'[сообщение без текста]')}</blockquote>`; return `🗑️ <b>УДАЛЕНО СООБЩЕНИЕ</b>\n${line()}\n\nОт: <b>неизвестно</b>\nMsg ID: <code>${esc(id||'')}</code>\nВремя: <code>${esc(fmtNow())}</code>\n\n⚠️ Бот не успел сохранить текст/медиа этого сообщения.` }
function split(arr,max=3500){let out=[],c=''; for(const x of arr){const n=c?c+'\n\n'+x:x; if(n.length>max){if(c)out.push(c); c=x}else c=n} if(c)out.push(c); return out}

async function reportNewMessage(d,x){
  if(!REPORT_MESSAGES||!OWNER_ID)return;
  const side=x.side==='right'?'Владелец':'Клиент';
  const media=x.media?`\n📎 Медиа: <code>${esc(x.media.label||x.media.type||'media')}</code>\nMedia ID: <code>${esc(x.message_id||'')}</code>`:'';
  const text=x.text||x.plain||'';
  const body=text?`\n\n<b>Текст:</b>\n<blockquote>${esc(text).slice(0,1200)}</blockquote>`:'';
  await owner(`📨 <b>НОВОЕ СООБЩЕНИЕ</b>\n${line()}\n\nЧат: <b>${esc(d.shortTitle||d.title||'')}</b>\nОт: <b>${esc(x.author_full||x.author||side)}</b>\nСторона: <code>${esc(side)}</code>\nMsg ID: <code>${esc(x.message_id||'')}</code>${media}${body}\n\nВремя: <code>${esc(x.time_text||fmtNow())}</code>`);
}
async function notify(req,d){ if(!OWNER_ID||d.notified)return; const url=chatUrl(req,d); await owner(`💬 <b>НОВЫЙ ЧАТ</b>\n${line()}\n\n<b>${esc(d.shortTitle||d.title)}</b>\n\nBusiness: <b>${esc(d.owner?.short||d.owner?.name||'')}</b>\nChat ID: <code>${esc(d.chat_id||'')}</code>\n\n🔗 <b>Открыть чат:</b>\n${esc(url)}\n\n🕘 <code>${esc(fmtNow())}</code>`); d.notified=true; await upDialog(d) }
function chatUrl(req,d){return `${origin(req)}/c?s=${encodeURIComponent(d.short_id)}&key=${encodeURIComponent(VIEWER_KEY)}`}
async function getMedia(id){ const r=await q(`select m.*,d.short_title,d.title from messages m join dialogs d on d.id=m.dialog_id where m.message_id=$1 and m.media is not null order by m.saved_at desc limit 1`,[String(id)]); const x=r.rows[0]; if(!x?.media?.file_id)return null; return{media:x.media,dialog_title:x.short_title||x.title||'',from:x.author_full||x.author||'',fromShort:x.author||'',text:x.text||'',date:x.date_ts} }
async function handleGet(m){ const id=String(m.text||'').trim().split(/\s+/)[1]; if(!id)return send(m.chat?.id,'Напиши так: <code>/get 63718</code>'); const data=await getMedia(id); if(!data)return send(m.chat?.id,`⚠️ Медиа с ID <code>${esc(id)}</code> не найдено.`); const cap=`📎 <b>${esc(data.media.label||'Медиа')}</b>\n🧾 Media ID: <code>${esc(id)}</code>\n💬 Диалог: <b>${esc(data.dialog_title)}</b>\n👤 От: ${esc(data.fromShort||data.from)}\n🕘 ${esc(fmt(data.date))}${data.text?`\n\n💬 ${esc(data.text)}`:''}`; const result=await sendRecoveredMediaToTarget(m.chat?.id,data.media,cap); if(!result?.ok)return send(m.chat?.id,`⚠️ Не получилось отправить медиа ID <code>${esc(id)}</code>.\n\n<code>${esc(JSON.stringify(result||{}))}</code>`); return result }
async function sendMedia(chatId,media,caption=''){ const common={chat_id:chatId,caption:caption.slice(0,1000),parse_mode:'HTML'}; if(!caption){delete common.caption; delete common.parse_mode} if(media.type==='photo')return tg('sendPhoto',{...common,photo:media.file_id}); if(media.type==='video')return tg('sendVideo',{...common,video:media.file_id}); if(media.type==='animation')return tg('sendAnimation',{...common,animation:media.file_id}); if(media.type==='audio')return tg('sendAudio',{...common,audio:media.file_id}); if(media.type==='voice')return tg('sendVoice',{...common,voice:media.file_id}); if(media.type==='sticker')return tg('sendSticker',{chat_id:chatId,sticker:media.file_id}); if(media.type==='video_note')return tg('sendVideoNote',{chat_id:chatId,video_note:media.file_id}); return tg('sendDocument',{...common,document:media.file_id}) }
async function tgMultipart(method,formData){
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',body:formData});
  const t=await r.text();
  if(!r.ok) console.log('TG multipart error',method,r.status,t);
  try{return JSON.parse(t)}catch{return{ok:false,raw:t}}
}
function extForMedia(media){
  const mt=String(media?.mime_type||'').toLowerCase();
  if(media?.type==='photo')return '.jpg';
  if(mt.includes('mp4'))return '.mp4';
  if(mt.includes('jpeg'))return '.jpg';
  if(mt.includes('png'))return '.png';
  if(mt.includes('webp'))return '.webp';
  if(mt.includes('ogg'))return '.ogg';
  return '.bin';
}
async function downloadTelegramFile(fileId){
  const g=await tg('getFile',{file_id:fileId});
  if(!g?.ok||!g.result?.file_path)throw new Error('getFile failed: '+JSON.stringify(g||{}));
  const r=await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${g.result.file_path}`);
  if(!r.ok)throw new Error('download failed: '+r.status);
  return await r.arrayBuffer();
}
async function uploadMediaAsDocument(chatId,media,caption=''){
  if(!chatId||!media?.file_id)return{ok:false,error:'missing chatId or file_id'};
  const buf=await downloadTelegramFile(media.file_id);
  const name=media.file_name || `selfdestruct_${Date.now()}${extForMedia(media)}`;
  const mime=media.mime_type || (media.type==='photo'?'image/jpeg':'application/octet-stream');
  const form=new FormData();
  form.append('chat_id',String(chatId));
  form.append('document',new Blob([buf],{type:mime}),name);
  if(caption){
    form.append('caption',String(caption).slice(0,1000));
    form.append('parse_mode','HTML');
  }
  return tgMultipart('sendDocument',form);
}
async function cacheSelfDestructMediaIfNeeded(msg,stored){
  try{
    if(!stored?.media?.file_id)return stored;
    if(!msg.ttl_seconds)return stored;
    if(!['photo','video','video_note'].includes(stored.media.type))return stored;
    if(!OWNER_ID)return stored;

    const cap=
      `💾 <b>Кэш одноразового медиа</b>\n`+
      `Media ID: <code>${esc(stored.message_id||stored.id||msg.message_id||'')}</code>\n`+
      `Тип: ${esc(stored.media.label||stored.media.type)}\n`+
      `TTL: <code>${esc(msg.ttl_seconds)}</code> сек.`;

    const uploaded=await uploadMediaAsDocument(OWNER_ID,stored.media,cap);

    if(uploaded?.ok&&uploaded.result?.document?.file_id){
      stored.media={
        ...stored.media,
        original_type:stored.media.type,
        original_file_id:stored.media.file_id,
        type:'document',
        label:'Одноразовое медиа',
        file_id:uploaded.result.document.file_id,
        file_name:uploaded.result.document.file_name || stored.media.file_name || `selfdestruct_${stored.message_id||msg.message_id}${extForMedia(stored.media)}`,
        mime_type:uploaded.result.document.mime_type || stored.media.mime_type || ''
      };
      stored.raw_type='document';
      stored.plain='[💾 одноразовое медиа сохранено]';
    }else{
      await owner(`⚠️ <b>Не удалось закэшировать одноразовое медиа</b>\n\nMedia ID: <code>${esc(stored.message_id||msg.message_id||'')}</code>\n<code>${esc(JSON.stringify(uploaded||{}))}</code>`);
    }
  }catch(e){
    console.error('cacheSelfDestructMediaIfNeeded error:',e);
    await owner(`⚠️ <b>Ошибка кэша одноразового медиа</b>\n\n<code>${esc(String(e))}</code>`);
  }
  return stored;
}
async function sendRecoveredMediaToTarget(target,media,caption){
  let result=await sendMedia(target,media,caption);
  const descr=String(result?.description||result?.raw||'');

  if(!result?.ok && /SelfDestructing|self.?destruct/i.test(descr)){
    try{
      result=await uploadMediaAsDocument(target,media,caption);
    }catch(e){
      result={ok:false,error:String(e)};
    }
  }

  return result;
}
function deliveryFailureReason(result){
  const text=String(result?.description||result?.raw||result?.error||'').toLowerCase();
  if(/bot was blocked|blocked by the user/.test(text)) return 'Пользователь заблокировал бота, поэтому бот не может написать ему напрямую.';
  if(/chat not found|user not found|bot can.t initiate|bot can't initiate|bot was kicked|forbidden/.test(text)) return 'Пользователь ещё не открывал этого бота или Telegram не разрешает боту начать личный диалог первым.';
  return '';
}

async function handleStart(m){ const text=`🛡 <b>FrodRobot Web Chat</b>\n\nЭто бот для сохранения и просмотра важных Telegram Business-сообщений в удобном формате.\n\nБот помогает не потерять сообщения, даже если они были изменены или удалены.\n\n${line()}\n\n🔹 <b>Что умеет бот:</b>\n\n💬 <b>Сохраняет переписки</b>\nСообщения отображаются в Web-чате как настоящая переписка.\n\n✏️ <b>Показывает изменения</b>\nЕсли сообщение изменили, бот показывает старый и новый вариант.\n\n🗑 <b>Показывает удалённые сообщения</b>\nЕсли сообщение было сохранено до удаления, его можно увидеть в Web-чате.\n\n🖼 <b>Работает с медиа</b>\nФото, видео, голосовые, кружочки, документы, GIF и стикеры.\n\n🔎 <b>Поиск по Media ID</b>\nЕсли файл не открывается в Web-чате, отправь команду:\n<code>/get MEDIA_ID</code>\n\n${line()}\n\n🔌 <b>Как подключить бота:</b>\n\n1. Открой профиль бота.\n2. Нажми <b>Start</b>.\n3. Открой <b>Telegram Business</b> в настройках Telegram.\n4. Перейди в <b>Чат-боты</b>.\n5. Добавь этого бота и выдай права.\n\n✅ <b>Бот активен и готов к работе.</b>`; await send(m.chat?.id,text) }
async function onConn(c){ await saveConn(c); const u=c.user||{}; await owner(`${c.is_enabled?'✅ <b>Бот подключён</b>':'⛔ <b>Бот отключён</b>'}\n${line()}\n\n👤 <b>Аккаунт:</b> ${esc(uname(u))}\n🆔 <b>ID:</b> <code>${esc(u.id||'')}</code>\n\n🔗 <b>Business Connection ID:</b>\n<code>${esc(c.id||'')}</code>\n\n💬 <b>User Chat ID:</b> <code>${esc(c.user_chat_id||'')}</code>\n🕘 <b>${esc(c.date?fmt(c.date):fmtNow())}</b>`) }
async function update(req,u){ if(u.business_connection)await onConn(u.business_connection); if(u.message){if(isStart(u.message))await handleStart(u.message); else if(isGet(u.message))await handleGet(u.message); else await onMessage(req,u.message)} if(u.edited_message)await onEdit(req,u.edited_message); if(u.business_message){if(isStart(u.business_message))await handleStart(u.business_message); else await onMessage(req,u.business_message)} if(u.edited_business_message)await onEdit(req,u.edited_business_message); if(u.deleted_business_messages)await onDelete(req,u.deleted_business_messages) }
function isStart(m){return m.text&&(m.text==='/start'||m.text.startsWith('/start '))} function isGet(m){return m.text&&/^\/get(?:@\w+)?\s+\S+/i.test(m.text.trim())}
async function resolveDialogId(req){
  let id=String(req.query.id||'');
  if(!id&&req.query.s){
    const r=await q('select id from dialogs where short_id=$1',[String(req.query.s)]);
    id=r.rows[0]?.id||'';
  }
  return id;
}
function clampInt(v,min,max,fallback){const n=Number.parseInt(String(v??''),10);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
async function apiChat(req,res){
  const id=await resolveDialogId(req);
  if(id){
    const d=await dialogMeta(id);
    if(!d)return json(res,{ok:false,error:'Dialog not found'},404);
    const limit=clampInt(req.query.limit,20,200,80);
    const since=Number(req.query.since||0);
    if(since>0){
      const mr=await q(`select * from messages where dialog_id=$1 and saved_at>$2 order by saved_at asc limit $3`,[id,since,limit]);
      const latest=mr.rows.reduce((m,x)=>Math.max(m,Number(x.saved_at||0)),since);
      return json(res,{ok:true,dialog:{...d,messages:mr.rows.map(rowMsg)},cursor:latest,mode:'delta'});
    }
    const beforeTs=req.query.before_ts!==undefined?Number(req.query.before_ts):null;
    const beforeMid=req.query.before_mid!==undefined?String(req.query.before_mid):'';
    let mr;
    if(Number.isFinite(beforeTs)&&beforeMid){
      mr=await q(`select * from (
        select * from messages
        where dialog_id=$1 and (coalesce(date_ts,0)<$2 or (coalesce(date_ts,0)=$2 and message_id::bigint<$3::bigint))
        order by coalesce(date_ts,0) desc,message_id::bigint desc limit $4
      ) z order by coalesce(date_ts,0) asc,message_id::bigint asc`,[id,beforeTs,beforeMid,limit]);
    }else{
      mr=await q(`select * from (
        select * from messages where dialog_id=$1
        order by coalesce(date_ts,0) desc,message_id::bigint desc limit $2
      ) z order by coalesce(date_ts,0) asc,message_id::bigint asc`,[id,limit]);
    }
    const countR=await q('select count(*)::int cnt from messages where dialog_id=$1',[id]);
    d.messages=mr.rows.map(rowMsg);
    const newest=mr.rows.reduce((m,x)=>Math.max(m,Number(x.saved_at||0)),Number(d.updated_at||0));
    return json(res,{ok:true,dialog:d,cursor:newest,total:Number(countR.rows[0]?.cnt||0),has_more:mr.rows.length===limit,mode:'page'});
  }

  const dr=await q(`select * from dialogs order by updated_at desc limit 200`);
  const rows=dr.rows;
  const ids=rows.map(x=>x.id);
  const counts=new Map(),last=new Map();
  if(ids.length){
    const cr=await q(`select dialog_id,count(*)::int cnt from messages where dialog_id=any($1::text[]) group by dialog_id`,[ids]);
    for(const x of cr.rows)counts.set(String(x.dialog_id),Number(x.cnt||0));
    const lr=await q(`select distinct on (dialog_id) dialog_id,plain,text,raw_type,saved_at from messages where dialog_id=any($1::text[]) order by dialog_id,saved_at desc`,[ids]);
    for(const x of lr.rows)last.set(String(x.dialog_id),x.plain||x.text||'');
  }
  const dialogs=rows.map(x=>({id:x.id,short_id:x.short_id,business_connection_id:x.business_connection_id,chat_id:x.chat_id,title:x.title,shortTitle:x.short_title,owner:x.owner||{},peer:x.peer||{},updated_at:Number(x.updated_at||0),count:counts.get(String(x.id))||0,lastText:last.get(String(x.id))||''}));
  let owners=[];
  try{
    const cr=await q(`select id,user_id,user_name,user_short,user_chat_id,is_enabled,saved_at,date_ts from business_connections where coalesce(is_enabled,true)=true order by coalesce(saved_at,0) desc,coalesce(date_ts,0) desc limit 100`);
    const ownerCounts=new Map();
    for(const d of dialogs){const k=String(d.business_connection_id||'');ownerCounts.set(k,(ownerCounts.get(k)||0)+1)}
    owners=cr.rows.map(c=>{const short=(c.user_short||c.user_name||('ID:'+String(c.user_id||c.user_chat_id||c.id||''))).trim();return{connection_id:c.id,user_id:c.user_id||'',chat_id:c.user_chat_id||'',name:c.user_name||short,short,count:ownerCounts.get(String(c.id||''))||0}}).filter(o=>o.connection_id);
  }catch(e){console.log('owners load error',String(e))}
  return json(res,{ok:true,dialogs,owners,server_time:now()});
}
async function fileProxy(req,res){ const fileId=req.query.file_id; if(!fileId)return res.status(400).send('Missing file_id'); const g=await tg('getFile',{file_id:fileId}); if(!g?.ok||!g.result?.file_path)return res.status(404).send('Cannot get file'); const r=await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${g.result.file_path}`); if(!r.ok)return res.status(r.status).send('Cannot download file'); const ct=r.headers.get('content-type'); if(ct)res.set('Content-Type',ct); res.set('Cache-Control','private, max-age=3600'); res.send(Buffer.from(await r.arrayBuffer())) }
async function backup(req,res){ const dialogs=(await q('select * from dialogs order by updated_at desc')).rows, messages=(await q('select * from messages order by dialog_id,coalesce(date_ts,0),message_id')).rows, business_connections=(await q('select * from business_connections')).rows; res.setHeader('Content-Disposition',`attachment; filename="allsavemodbot-backup-${Date.now()}.json"`); return json(res,{version:2,exported_at:new Date().toISOString(),dialogs,messages,business_connections}) }
async function restore(req,res){ const b=req.body; if(!Array.isArray(b.dialogs)||!Array.isArray(b.messages))return json(res,{ok:false,error:'Bad backup'},400); for(const d of b.dialogs){await q(`insert into dialogs(id,short_id,business_connection_id,chat_id,title,short_title,owner,peer,notified,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(id) do update set short_id=excluded.short_id,title=excluded.title,short_title=excluded.short_title,owner=excluded.owner,peer=excluded.peer,notified=excluded.notified,updated_at=excluded.updated_at`,[d.id,d.short_id,d.business_connection_id,d.chat_id,d.title,d.short_title,d.owner||{},d.peer||{},!!d.notified,d.created_at||now(),d.updated_at||now()])} for(const m of b.messages){await q(`insert into messages(dialog_id,message_id,side,from_id,author,author_full,to_id,to_name,text,plain,date_ts,time_text,edited,edit_date,old_text,deleted,media,reply,raw_type,saved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) on conflict(dialog_id,message_id) do update set text=excluded.text,plain=excluded.plain,edited=excluded.edited,deleted=excluded.deleted,media=excluded.media,reply=excluded.reply,saved_at=excluded.saved_at`,[m.dialog_id,String(m.message_id||m.id||''),m.side,m.from_id,m.author,m.author_full,m.to_id,m.to_name||m.to,m.text,m.plain,m.date_ts||m.date,m.time_text||m.timeText,!!m.edited,m.edit_date,m.old_text,!!m.deleted,m.media||null,m.reply||null,m.raw_type,m.saved_at||now()])} return json(res,{ok:true,imported:{dialogs:b.dialogs.length,messages:b.messages.length}}) }
function importPage(req){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#0d1b24;color:white;padding:24px}.box{max-width:650px;margin:auto;background:#132634;padding:20px;border-radius:18px}button,input{font-size:16px;padding:12px;border-radius:10px;margin:8px 0}button{background:#4da3ff;border:0;color:white;font-weight:800}a{color:#9fd0ff}pre{white-space:pre-wrap;background:#0b1820;padding:12px;border-radius:12px}</style></head><body><div class="box"><h2>⬆️ Восстановить backup</h2><input type="file" id="file" accept="application/json"><br><button onclick="upload()">Восстановить</button><p><a href="/?key=${attr(req.query.key||'')}">← Назад</a></p><pre id="out"></pre></div><script>async function upload(){const f=document.getElementById('file').files[0];if(!f)return alert('Выбери файл');const data=JSON.parse(await f.text());const r=await fetch('/import?key=${attr(req.query.key||'')}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});document.getElementById('out').textContent=JSON.stringify(await r.json(),null,2)}</script></body></html>`}
function home(req){const key=encodeURIComponent(VIEWER_KEY);return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08131a"><title>FrodRobot — Чаты</title><style>
:root{--bg:#071116;--panel:rgba(14,29,37,.86);--panel2:#10232d;--card:rgba(18,39,49,.82);--cardHover:rgba(24,49,61,.95);--text:#f3f7f9;--muted:#8298a4;--line:rgba(255,255,255,.075);--accent:#36bffa;--green:#18c69b;--danger:#ff7f87;--shadow:0 26px 70px rgba(0,0,0,.38)}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}body{background:radial-gradient(circle at 15% -10%,rgba(54,191,250,.14),transparent 31rem),radial-gradient(circle at 100% 15%,rgba(24,198,155,.11),transparent 28rem),#071116}button,input{font:inherit}.app{width:min(1120px,100%);min-height:100vh;margin:auto;background:rgba(7,17,22,.55)}.topbar{position:sticky;top:0;z-index:8;padding:max(16px,env(safe-area-inset-top)) 18px 13px;background:rgba(7,17,22,.82);backdrop-filter:blur(22px) saturate(140%);border-bottom:1px solid var(--line)}.brandrow{display:flex;align-items:center;gap:12px}.logo{width:46px;height:46px;border-radius:16px;background:linear-gradient(145deg,#3bc8ff,#17c99b);display:grid;place-items:center;font-weight:950;letter-spacing:-1px;color:#05212a;box-shadow:0 10px 28px rgba(33,192,210,.25)}.brand{min-width:0;flex:1}.title{font-size:21px;font-weight:900;letter-spacing:-.35px}.subtitle{font-size:12px;color:var(--muted);margin-top:2px}.status{display:flex;align-items:center;gap:7px;font-size:12px;color:#a5f1dc;background:rgba(24,198,155,.10);border:1px solid rgba(24,198,155,.2);padding:7px 10px;border-radius:999px}.dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(24,198,155,.10)}.stats{display:flex;gap:8px;margin-top:14px;overflow:auto;scrollbar-width:none}.stats::-webkit-scrollbar{display:none}.stat{min-width:116px;flex:1;background:linear-gradient(180deg,rgba(20,44,55,.84),rgba(12,31,39,.84));border:1px solid var(--line);border-radius:15px;padding:10px 12px}.stat b{display:block;font-size:18px}.stat span{display:block;font-size:10px;color:var(--muted);margin-top:2px;text-transform:uppercase;letter-spacing:.65px}.searchbox{position:relative;margin-top:12px}.searchIcon{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:#6f8793}.search{width:100%;height:46px;border:1px solid var(--line);border-radius:15px;background:rgba(17,37,47,.9);color:var(--text);padding:0 44px 0 39px;outline:0;transition:.2s}.search:focus{border-color:rgba(54,191,250,.45);box-shadow:0 0 0 4px rgba(54,191,250,.07)}.clear{position:absolute;right:8px;top:7px;width:32px;height:32px;border:0;background:transparent;color:#8298a4;border-radius:10px;cursor:pointer}.clear:hover{background:rgba(255,255,255,.06);color:white}.tabs{display:flex;gap:7px;overflow:auto;padding:10px 0 0;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tab{border:1px solid var(--line);border-radius:999px;background:rgba(16,35,45,.9);color:#b4c3ca;padding:8px 12px;white-space:nowrap;cursor:pointer;transition:.18s}.tab:hover{transform:translateY(-1px);border-color:rgba(54,191,250,.25)}.tab.active{background:linear-gradient(135deg,rgba(54,191,250,.22),rgba(24,198,155,.16));border-color:rgba(54,191,250,.4);color:#eefaff}.list{padding:13px 14px 92px;display:grid;gap:8px}.card{position:relative;display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:18px;text-decoration:none;color:inherit;background:linear-gradient(135deg,var(--card),rgba(12,29,37,.78));box-shadow:0 8px 24px rgba(0,0,0,.10);transition:transform .18s ease,border-color .18s ease,background .18s ease;content-visibility:auto;contain-intrinsic-size:78px;overflow:hidden}.card:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(var(--accent),var(--green));opacity:0;transition:.18s}.card:hover{transform:translateY(-2px);background:var(--cardHover);border-color:rgba(54,191,250,.18)}.card.unread{border-color:rgba(54,191,250,.25);background:linear-gradient(135deg,rgba(22,49,61,.96),rgba(11,31,40,.92))}.card.unread:before{opacity:1}.ava{width:52px;height:52px;border-radius:17px;display:grid;place-items:center;background:linear-gradient(145deg,#244c5d,#173745);color:#e7fbff;font-weight:900;border:1px solid rgba(255,255,255,.08);box-shadow:inset 0 1px rgba(255,255,255,.08)}.body{min-width:0}.row{display:flex;align-items:center;gap:7px}.name{font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;letter-spacing:-.15px}.time{font-size:11px;color:var(--muted);white-space:nowrap}.last{margin-top:5px;color:#abc0c9;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.metaLine{margin-top:5px;display:flex;align-items:center;gap:6px;min-width:0}.business{color:#69828e;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.unreadDot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(54,191,250,.10);flex:0 0 auto}.count{font-size:10px;color:#bee7f5;background:rgba(54,191,250,.10);border:1px solid rgba(54,191,250,.12);padding:5px 7px;border-radius:999px}.empty{margin:26px auto;padding:34px 20px;max-width:430px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:20px;background:rgba(15,32,40,.4)}.emptyIcon{font-size:30px;margin-bottom:8px}.bottom{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:10;display:flex;gap:5px;padding:6px;border-radius:17px;background:rgba(16,34,43,.9);border:1px solid var(--line);backdrop-filter:blur(18px);box-shadow:var(--shadow)}.bottom a,.bottom button{height:42px;min-width:44px;border:0;background:transparent;color:#b7c8cf;text-decoration:none;padding:0 13px;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}.bottom a:hover,.bottom button:hover{background:rgba(255,255,255,.06);color:white}.refreshing .dot{animation:pulse 1s infinite}@keyframes pulse{50%{opacity:.25;transform:scale(.7)}}@media(min-width:900px){.app{margin:18px auto;min-height:calc(100vh - 36px);border:1px solid var(--line);border-radius:26px;overflow:hidden;box-shadow:var(--shadow)}.topbar{padding-left:22px;padding-right:22px}.list{grid-template-columns:1fr 1fr;padding:15px 18px 92px}.bottom{bottom:24px}}@media(max-width:600px){.topbar{padding-left:10px;padding-right:10px}.status{display:none}.stats{margin-top:11px}.stat{min-width:100px;padding:9px 10px}.list{padding:9px 7px 88px}.card{grid-template-columns:46px minmax(0,1fr) auto;padding:10px;border-radius:16px}.ava{width:46px;height:46px;border-radius:15px}.bottom{bottom:max(8px,env(safe-area-inset-bottom))}.bottom span.label{display:none}}
</style></head><body><div class="app"><header class="topbar"><div class="brandrow"><div class="logo">FR</div><div class="brand"><div class="title">FrodRobot</div><div class="subtitle">Telegram Business · Web Inbox</div></div><div id="status" class="status"><span class="dot"></span><span id="statusText">онлайн</span></div></div><div class="stats"><div class="stat"><b id="statAll">0</b><span>всего чатов</span></div><div class="stat"><b id="statUnread">0</b><span>новых</span></div><div class="stat"><b id="statAccounts">0</b><span>аккаунтов</span></div></div><div class="searchbox"><span class="searchIcon">⌕</span><input id="search" class="search" placeholder="Поиск по имени, сообщению или ID…" autocomplete="off"><button class="clear" onclick="clearSearch()">×</button></div><div id="tabs" class="tabs"><button class="tab active" data-filter="all">Все</button></div></header><main id="list" class="list"><div class="empty"><div class="emptyIcon">◌</div>Загрузка чатов…</div></main></div><nav class="bottom"><button onclick="load(true)" title="Обновить">↻ <span class="label">Обновить</span></button><a href="/export?key=${key}" title="Backup">⇩ <span class="label">Backup</span></a><a href="/import?key=${key}" title="Import">⇧ <span class="label">Import</span></a></nav><script>
const KEY=${JSON.stringify(VIEWER_KEY)},API='/api/chat?key='+encodeURIComponent(KEY);let dialogs=[],ownersData=[],lastHash='',filter='all',loading=false;
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function initials(s){return String(s||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'?'}
function ownerName(d){return (d.owner&&(d.owner.short||d.owner.name))||''} function peerName(d){return (d.peer&&(d.peer.short||d.peer.name))||''}
function unread(d){const r=Number(localStorage.getItem('read_at:'+(d.short_id||d.id))||0);return Number(d.updated_at||0)>r}
function when(v){let n=Number(v||0);if(!n)return'';if(n<1e12)n*=1000;const d=new Date(n),today=new Date();if(d.toDateString()===today.toDateString())return new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(d);return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit'}).format(d)}
function preview(t){const x=String(t||'').trim();if(!x)return'Нет текста';return x.replace(/^\[(.+)\]$/,'$1')}
function updateStats(){const u=dialogs.filter(unread).length;document.getElementById('statAll').textContent=dialogs.length;document.getElementById('statUnread').textContent=u;document.getElementById('statAccounts').textContent=(ownersData||[]).filter(o=>o&&o.connection_id).length}
function buildTabs(){const box=document.getElementById('tabs'),owners=(ownersData||[]).filter(o=>o&&o.connection_id);if(filter!=='all'&&filter!=='unread'&&!owners.some(o=>String(o.connection_id)===String(filter)))filter='all';const newCount=dialogs.filter(unread).length;box.innerHTML='<button class="tab '+(filter==='all'?'active':'')+'" data-filter="all">Все · '+dialogs.length+'</button><button class="tab '+(filter==='unread'?'active':'')+'" data-filter="unread">Новые · '+newCount+'</button>'+owners.map(o=>'<button class="tab '+(String(filter)===String(o.connection_id)?'active':'')+'" data-filter="'+esc(o.connection_id)+'">'+esc(o.short||o.name||'Аккаунт')+' · '+Number(o.count||0)+'</button>').join('');box.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{filter=b.dataset.filter||'all';render()})}
function render(){updateStats();buildTabs();const q=document.getElementById('search').value.trim().toLowerCase();const items=dialogs.filter(d=>{const f=filter==='all'||(filter==='unread'&&unread(d))||String(d.business_connection_id||'')===String(filter);const s=!q||[d.title,d.shortTitle,d.chat_id,d.lastText,ownerName(d),peerName(d)].filter(Boolean).some(x=>String(x).toLowerCase().includes(q));return f&&s});const list=document.getElementById('list');if(!items.length){list.innerHTML='<div class="empty"><div class="emptyIcon">'+(dialogs.length?'⌕':'◌')+'</div>'+(dialogs.length?'Ничего не найдено':'Пока чатов нет. Новые диалоги появятся здесь автоматически.')+'</div>';return}list.innerHTML=items.map(d=>{const href=d.short_id?'/c?s='+encodeURIComponent(d.short_id)+'&key='+encodeURIComponent(KEY):'/chat?id='+encodeURIComponent(d.id)+'&key='+encodeURIComponent(KEY),u=unread(d),title=d.shortTitle||d.title||peerName(d)||'Диалог';return '<a class="card '+(u?'unread':'')+'" href="'+href+'"><div class="ava">'+esc(initials(title))+'</div><div class="body"><div class="row"><div class="name">'+esc(title)+'</div><div class="time">'+esc(when(d.updated_at))+'</div></div><div class="last">'+esc(preview(d.lastText))+'</div><div class="metaLine">'+(u?'<span class="unreadDot"></span>':'')+'<div class="business">'+esc(ownerName(d)||'Business аккаунт')+'</div></div></div><div class="count">'+Number(d.count||0)+'</div></a>'}).join('')}
async function load(force=false){if(loading)return;loading=true;document.body.classList.add('refreshing');try{const r=await fetch(API,{cache:'no-store'}),d=await r.json();if(!d.ok)throw new Error(d.error||'load');const h=JSON.stringify([d.dialogs,d.owners]);if(force||h!==lastHash){lastHash=h;dialogs=d.dialogs||[];ownersData=d.owners||[];render()}document.getElementById('statusText').textContent='онлайн'}catch(e){document.getElementById('statusText').textContent='ошибка сети'}finally{loading=false;document.body.classList.remove('refreshing')}}
function clearSearch(){const x=document.getElementById('search');if(!x.value)return;x.value='';render();x.focus()}let searchTimer;document.getElementById('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(render,100)});load(true);setInterval(()=>{if(!document.hidden)load(false)},8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load(false)});
</script></body></html>`}

function chatPage(req){const id=req.query.id||'',s=req.query.s||'',key=req.query.key||'';return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08131a"><title>FrodRobot Chat</title><style>
:root{--bg:#071116;--header:rgba(9,22,29,.88);--left:#152b36;--right:#075f55;--text:#f0f5f7;--muted:#8298a4;--line:rgba(255,255,255,.075);--accent:#38bdf8;--green:#19c69c;--danger:#ff858d}*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0,rgba(56,189,248,.09),transparent 30rem),radial-gradient(circle at 90% 60%,rgba(25,198,156,.07),transparent 34rem),#071116;color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.23;background-image:radial-gradient(rgba(255,255,255,.12) .55px,transparent .55px);background-size:18px 18px;mask-image:linear-gradient(to bottom,transparent,#000 12%,#000 88%,transparent)}button,input{font:inherit}.header{position:sticky;top:0;z-index:12;background:var(--header);backdrop-filter:blur(22px) saturate(140%);border-bottom:1px solid var(--line);padding:max(9px,env(safe-area-inset-top)) 10px 9px}.top{display:flex;align-items:center;gap:10px;max-width:980px;margin:auto}.back,.ref{height:42px;border:1px solid var(--line);border-radius:13px;background:rgba(20,43,53,.7);color:#dff5fc;font-weight:800;text-decoration:none;display:grid;place-items:center;padding:0 12px;cursor:pointer;transition:.18s}.back:hover,.ref:hover{background:rgba(29,57,68,.9);transform:translateY(-1px)}.ref{width:42px;padding:0}.avatar{width:42px;height:42px;border-radius:15px;background:linear-gradient(145deg,#38bdf8,#19c69c);display:grid;place-items:center;font-weight:950;color:#05232a;box-shadow:0 9px 25px rgba(39,188,208,.18)}.head{min-width:0;flex:1}.name{font-size:16px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.2px}.sub{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.live{color:#69e6c1;font-size:10px}.searchWrap{max-width:980px;margin:8px auto 0;position:relative}.searchIcon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#6e8792}.search{width:100%;height:39px;border:1px solid var(--line);outline:0;border-radius:13px;background:rgba(15,34,43,.9);color:var(--text);padding:0 38px;font-size:13px;transition:.18s}.search:focus{border-color:rgba(56,189,248,.38);box-shadow:0 0 0 4px rgba(56,189,248,.06)}.clearSearch{position:absolute;right:5px;top:4px;width:31px;height:31px;border:0;border-radius:9px;background:transparent;color:#718a95;cursor:pointer}.clearSearch:hover{background:rgba(255,255,255,.06);color:white}.chat{max-width:930px;margin:0 auto;padding:12px 10px 92px;overflow-anchor:none;position:relative}.older{display:flex;justify-content:center;margin:2px 0 14px}.older button{border:1px solid var(--line);background:rgba(20,43,53,.82);color:#d9e9ef;padding:8px 13px;border-radius:999px;cursor:pointer;backdrop-filter:blur(10px);transition:.18s}.older button:hover{transform:translateY(-1px);border-color:rgba(56,189,248,.28)}.day{text-align:center;margin:11px 0 14px;position:sticky;top:104px;z-index:3;pointer-events:none}.day span{display:inline-block;background:rgba(14,31,39,.88);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:999px;padding:6px 11px;color:#b8c9d0;font-size:10px;box-shadow:0 5px 20px rgba(0,0,0,.14)}.row{display:flex;margin:6px 0;animation:rise .16s ease both}.left{justify-content:flex-start}.right{justify-content:flex-end}@keyframes rise{from{opacity:.65;transform:translateY(2px)}to{opacity:1;transform:none}}.bubble{position:relative;max-width:min(78%,610px);border-radius:17px;padding:9px 10px 7px;box-shadow:0 7px 22px rgba(0,0,0,.14);overflow:hidden;word-wrap:break-word;white-space:pre-wrap;content-visibility:auto;contain-intrinsic-size:58px;border:1px solid rgba(255,255,255,.045)}.left .bubble{background:linear-gradient(145deg,#17303c,#132833);border-top-left-radius:6px}.right .bubble{background:linear-gradient(145deg,#087064,#07594f);border-top-right-radius:6px}.bubble:hover{border-color:rgba(255,255,255,.085)}.author{font-size:11px;color:#7fd8fb;margin-bottom:4px;font-weight:750}.right .author{color:#9ff0d8}.text{font-size:14.5px;line-height:1.38}.meta{display:flex;gap:7px;justify-content:flex-end;color:rgba(233,240,243,.54);font-size:9.5px;margin-top:5px;align-items:center}.badge{padding:2px 5px;border-radius:999px;background:rgba(255,255,255,.06)}.old{display:block;background:rgba(0,0,0,.16);border-left:3px solid rgba(255,255,255,.26);border-radius:8px;padding:6px 8px;color:rgba(233,237,239,.58);text-decoration:line-through;margin-bottom:6px;font-size:12px}.deleted .bubble{outline:1px solid rgba(255,105,115,.22)}.deleted .text{color:rgba(233,237,239,.58);text-decoration:line-through}.reply{border-left:3px solid #4cc9f0;background:rgba(255,255,255,.06);padding:6px 8px;border-radius:9px;margin-bottom:6px;color:rgba(233,237,239,.78);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.reply:hover{background:rgba(255,255,255,.09)}.flash .bubble{animation:flash 1.2s ease}@keyframes flash{0%,100%{box-shadow:0 7px 22px rgba(0,0,0,.14)}40%{box-shadow:0 0 0 3px rgba(56,189,248,.32),0 10px 30px rgba(0,0,0,.2)}}.media{margin-top:7px;border-radius:13px;overflow:hidden;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.055)}.media img,.media video{display:block;width:100%;max-height:440px;object-fit:contain;background:#030607}.mediaPad{padding:10px}.mid{font-size:9.5px;color:rgba(233,237,239,.5);margin-top:5px}audio{width:100%;height:38px}code{background:rgba(0,0,0,.2);border-radius:5px;padding:1px 4px}.empty{color:var(--muted);text-align:center;padding:42px 20px}.emptyIcon{font-size:30px;margin-bottom:8px}.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:rgba(23,48,59,.94);border:1px solid var(--line);backdrop-filter:blur(16px);color:white;padding:10px 13px;border-radius:999px;font-size:11px;display:none;z-index:30;box-shadow:0 12px 34px rgba(0,0,0,.28)}.jump{position:fixed;right:18px;bottom:20px;z-index:22;width:45px;height:45px;border:1px solid var(--line);border-radius:15px;background:rgba(17,40,50,.9);backdrop-filter:blur(14px);color:#e7f6fb;font-size:20px;display:none;place-items:center;cursor:pointer;box-shadow:0 12px 34px rgba(0,0,0,.25)}.jump.show{display:grid}.skeleton{max-width:930px;margin:auto;padding:16px 10px}.sk{height:56px;width:58%;border-radius:16px;background:linear-gradient(90deg,rgba(255,255,255,.035),rgba(255,255,255,.07),rgba(255,255,255,.035));background-size:200% 100%;animation:sh 1.1s infinite;margin:8px 0}.sk.r{margin-left:auto;width:50%}@keyframes sh{to{background-position:-200% 0}}@media(max-width:600px){.header{padding-left:7px;padding-right:7px}.chat{padding-left:6px;padding-right:6px}.bubble{max-width:88%;border-radius:15px}.text{font-size:14px}.back{padding:0 9px}.day{top:101px}.jump{right:10px;bottom:max(13px,env(safe-area-inset-bottom))}}
</style></head><body><header class="header"><div class="top"><a class="back" href="/?key=${attr(key)}">‹ <span class="backText">Чаты</span></a><div class="avatar" id="ava">?</div><div class="head"><div class="name" id="title">Загрузка…</div><div class="sub" id="sub">синхронизация <span id="live" class="live">●</span></div></div><button class="ref" onclick="refreshNow()" title="Обновить">↻</button></div><div class="searchWrap"><span class="searchIcon">⌕</span><input id="search" class="search" placeholder="Поиск в этом чате…" autocomplete="off"><button class="clearSearch" onclick="clearSearch()">×</button></div></header><main id="chat" class="chat"><div class="skeleton"><div class="sk"></div><div class="sk r"></div><div class="sk"></div><div class="sk r"></div></div></main><button id="jump" class="jump" onclick="goBottom()" title="К последним сообщениям">↓</button><div id="toast" class="toast"></div><script>
const DIALOG_ID=${JSON.stringify(id)},SHORT_ID=${JSON.stringify(s)},KEY=${JSON.stringify(key)},BASE=SHORT_ID?'/api/chat?s='+encodeURIComponent(SHORT_ID)+'&key='+encodeURIComponent(KEY):'/api/chat?id='+encodeURIComponent(DIALOG_ID)+'&key='+encodeURIComponent(KEY);let dialog=null,total=0,cursor=0,hasMore=true,loading=false,msgMap=new Map(),searchQ='';
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}function initials(s){return String(s||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'?'}function fileUrl(id){return'/file?file_id='+encodeURIComponent(id)+'&key='+encodeURIComponent(KEY)}
function mediaHtml(m){if(!m||!m.media||!m.media.file_id)return'';const a=m.media,u=fileUrl(a.file_id),id=m.message_id||m.id||'',mid='<div class="mid">Media ID: <code>'+esc(id)+'</code> · /get '+esc(id)+'</div>';if(a.type==='photo')return'<div class="media"><img src="'+u+'" loading="lazy" decoding="async"></div>'+mid;if(a.type==='video'||a.type==='video_note'||a.type==='animation')return'<div class="media"><video src="'+u+'" controls playsinline preload="none"></video></div>'+mid;if(a.type==='voice'||a.type==='audio')return'<div class="media mediaPad"><audio src="'+u+'" controls preload="none"></audio></div>'+mid;return'<div class="media mediaPad"><b>📎 '+esc(a.file_name||a.label||'Медиа')+'</b><div class="mid">Получить в Telegram: <code>/get '+esc(id)+'</code></div></div>'+mid}
function match(m,q){if(!q)return true;q=q.toLowerCase();return[m.text,m.plain,m.author,m.author_full,m.id,m.message_id,m.media&&m.media.file_name,m.media&&m.media.label].filter(Boolean).some(x=>String(x).toLowerCase().includes(q))}
function ordered(){return Array.from(msgMap.values()).sort((a,b)=>Number(a.date||0)-Number(b.date||0)||Number(a.message_id||0)-Number(b.message_id||0))}
function render(){const root=document.getElementById('chat');if(!dialog){root.innerHTML='<div class="empty"><div class="emptyIcon">◌</div>Нет данных</div>';return}const title=dialog.shortTitle||dialog.title||'Диалог';document.getElementById('title').textContent=title;document.getElementById('ava').textContent=initials(title);const ms=ordered().filter(m=>match(m,searchQ));document.getElementById('sub').firstChild.textContent='сообщений: '+total+' · загружено: '+msgMap.size+' ';let html=(hasMore&&!searchQ?'<div class="older"><button onclick="loadOlder()">↑ Показать более ранние</button></div>':'')+'<div class="day"><span>'+(searchQ?'Найдено: '+ms.length:'Последние сообщения')+'</span></div>';for(const m of ms){const side=m.side==='right'?'right':'left',cls='row '+side+(m.deleted?' deleted':'');let cont='';if(m.reply)cont+='<div class="reply" data-reply="'+esc(m.reply.message_id||'')+'" onclick="jumpReply(this.dataset.reply)">↳ '+esc(m.reply.author||'')+': '+esc(m.reply.text||'')+'</div>';if(m.edited&&m.old_text&&m.old_text!==m.text)cont+='<span class="old">Было: '+esc(m.old_text)+'</span>';cont+='<div class="text">'+esc(m.text||m.plain||'')+'</div>'+mediaHtml(m);html+='<div class="'+cls+'" data-mid="'+esc(m.message_id||m.id||'')+'"><div class="bubble"><div class="author">'+esc(m.author||'unknown')+'</div>'+cont+'<div class="meta"><span>ID:'+esc(m.id||m.message_id||'')+'</span><span>'+esc(m.timeText||'')+'</span>'+(m.edited?'<span class="badge">изм.</span>':'')+(m.deleted?'<span class="badge">удалено</span>':'')+'</div></div></div>'}root.innerHTML=html||'<div class="empty"><div class="emptyIcon">⌕</div>Ничего не найдено</div>';updateJump()}
function nearBottom(){const e=document.scrollingElement;return e.scrollHeight-window.scrollY-window.innerHeight<220}function goBottom(){scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}function updateJump(){document.getElementById('jump').classList.toggle('show',!nearBottom())}function toast(t){const x=document.getElementById('toast');x.textContent=t;x.style.display='block';setTimeout(()=>x.style.display='none',1700)}
function jumpReply(id){if(!id)return;const all=document.querySelectorAll('[data-mid]');for(const el of all){if(String(el.dataset.mid)===String(id)){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1300);return}}toast('Это сообщение ещё не загружено')}
function mergeMessages(arr){let changed=0;for(const m of(arr||[])){const k=String(m.message_id||m.id||'');const prev=msgMap.get(k);if(!prev||JSON.stringify(prev)!==JSON.stringify(m)){msgMap.set(k,m);changed++}}return changed}
async function initial(){if(loading)return;loading=true;try{const r=await fetch(BASE+'&limit=80',{cache:'no-store'}),d=await r.json();if(!d.ok)throw new Error(d.error||'load');dialog=d.dialog;total=Number(d.total||0);cursor=Number(d.cursor||dialog.updated_at||0);hasMore=!!d.has_more;mergeMessages(dialog.messages||[]);localStorage.setItem('read_at:'+(dialog.short_id||DIALOG_ID||SHORT_ID||dialog.id||''),String(dialog.updated_at||Date.now()));render();requestAnimationFrame(()=>scrollTo(0,document.body.scrollHeight));document.getElementById('live').textContent='●'}catch(e){document.getElementById('chat').innerHTML='<div class="empty"><div class="emptyIcon">!</div>Не удалось загрузить чат</div>';document.getElementById('live').textContent='×'}finally{loading=false}}
async function poll(force=false){if(loading||document.hidden&&!force)return;loading=true;try{const wasBottom=nearBottom();const r=await fetch(BASE+'&since='+encodeURIComponent(cursor)+'&limit=200',{cache:'no-store'}),d=await r.json();if(!d.ok)throw new Error(d.error||'poll');cursor=Math.max(cursor,Number(d.cursor||0),Number(d.dialog&&d.dialog.updated_at||0));if(d.dialog){dialog={...dialog,...d.dialog,messages:undefined};const beforeSize=msgMap.size,c=mergeMessages(d.dialog.messages||[]),added=Math.max(0,msgMap.size-beforeSize);if(c){total+=added;render();localStorage.setItem('read_at:'+(dialog.short_id||DIALOG_ID||SHORT_ID||dialog.id||''),String(dialog.updated_at||Date.now()));if(wasBottom&&!searchQ)requestAnimationFrame(()=>scrollTo(0,document.body.scrollHeight));else toast(c+' новых/изменённых')}}document.getElementById('live').textContent='●'}catch(e){document.getElementById('live').textContent='×'}finally{loading=false}}
async function loadOlder(){if(loading||!hasMore)return;const all=ordered(),first=all[0];if(!first)return;loading=true;const oldH=document.documentElement.scrollHeight,oldY=window.scrollY;try{const u=BASE+'&limit=80&before_ts='+encodeURIComponent(Number(first.date||0))+'&before_mid='+encodeURIComponent(first.message_id||first.id||'0'),r=await fetch(u,{cache:'no-store'}),d=await r.json();if(!d.ok)throw new Error(d.error||'older');hasMore=!!d.has_more;mergeMessages(d.dialog.messages||[]);render();requestAnimationFrame(()=>scrollTo(0,oldY+(document.documentElement.scrollHeight-oldH)))}catch(e){toast('Не удалось загрузить старые сообщения')}finally{loading=false}}
function refreshNow(){poll(true)}function clearSearch(){const x=document.getElementById('search');if(!x.value)return;x.value='';searchQ='';render();x.focus()}let st;document.getElementById('search').addEventListener('input',e=>{clearTimeout(st);st=setTimeout(()=>{searchQ=e.target.value.trim();render()},100)});window.addEventListener('scroll',updateJump,{passive:true});initial();setInterval(()=>poll(false),4000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll(true)});
</script></body></html>`}

function info(req){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#071116"><title>FrodRobot</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 18% 5%,rgba(56,189,248,.15),transparent 28rem),radial-gradient(circle at 90% 90%,rgba(25,198,156,.12),transparent 30rem),#071116;color:#f1f7f9;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}.box{width:min(94vw,410px);background:rgba(14,31,40,.86);border:1px solid rgba(255,255,255,.08);padding:24px;border-radius:25px;box-shadow:0 30px 85px rgba(0,0,0,.38);backdrop-filter:blur(20px)}.logo{width:60px;height:60px;border-radius:19px;background:linear-gradient(145deg,#38bdf8,#19c69c);display:grid;place-items:center;font-weight:950;color:#05242b;box-shadow:0 12px 32px rgba(38,192,209,.22);margin-bottom:17px}.eyebrow{font-size:11px;color:#75d9f7;text-transform:uppercase;letter-spacing:1px;font-weight:800}h2{margin:5px 0 7px;font-size:25px;letter-spacing:-.6px}.muted{color:#8298a4;font-size:13px;line-height:1.45}.field{position:relative;margin-top:19px}.key{width:100%;height:48px;border:1px solid rgba(255,255,255,.09);border-radius:15px;background:#0b2029;color:white;padding:0 44px 0 13px;outline:none}.key:focus{border-color:rgba(56,189,248,.45);box-shadow:0 0 0 4px rgba(56,189,248,.06)}.eye{position:absolute;right:7px;top:7px;width:34px;height:34px;border:0;border-radius:10px;background:transparent;color:#78909b;cursor:pointer}.eye:hover{background:rgba(255,255,255,.06);color:white}.go{width:100%;height:48px;margin-top:10px;border:0;border-radius:15px;background:linear-gradient(135deg,#38bdf8,#19c69c);color:#05242b;font-weight:900;cursor:pointer;box-shadow:0 10px 28px rgba(38,192,209,.15)}.foot{margin-top:14px;color:#637b86;font-size:11px;text-align:center}</style></head><body><div class="box"><div class="logo">FR</div><div class="eyebrow">Web Inbox</div><h2>Добро пожаловать</h2><div class="muted">Введите VIEWER_KEY. После входа откроется быстрый интерфейс чатов FrodRobot.</div><div class="field"><input id="k" class="key" type="password" placeholder="VIEWER_KEY" autocomplete="current-password"><button class="eye" onclick="toggle()">◉</button></div><button class="go" onclick="go()">Открыть чаты →</button><div class="foot">Telegram Business · Neon · Render</div></div><script>function go(){const k=document.getElementById('k').value.trim();if(k)location.href='/?key='+encodeURIComponent(k)}function toggle(){const x=document.getElementById('k');x.type=x.type==='password'?'text':'password'}document.getElementById('k').addEventListener('keydown',e=>{if(e.key==='Enter')go()})</script></body></html>`}
function blocked(){return '<body style="font-family:system-ui;background:#101820;color:white;padding:30px"><h2>403 Forbidden</h2><p>Неверный key.</p></body>'}
app.get('/',(req,res)=> okKey(req)?html(res,home(req)):html(res,info(req)) );
app.get('/chat',(req,res)=> okKey(req)?html(res,(req.query.id||req.query.s)?chatPage(req):home(req)):html(res,blocked(),403));
app.get('/c',(req,res)=> okKey(req)?html(res,chatPage(req)):html(res,blocked(),403));
app.get('/api/chat',(req,res)=> okKey(req)?apiChat(req,res):json(res,{ok:false,error:'Forbidden'},403));
app.get('/file',(req,res)=> okKey(req)?fileProxy(req,res):res.status(403).send('Forbidden'));
app.get('/export',(req,res)=> okKey(req)?backup(req,res):json(res,{ok:false,error:'Forbidden'},403));
app.get('/import',(req,res)=> okKey(req)?html(res,importPage(req)):html(res,blocked(),403));
app.post('/import',(req,res)=> okKey(req)?restore(req,res):json(res,{ok:false,error:'Forbidden'},403));
app.post('/webhook',async(req,res)=>{ if(SECRET_TOKEN && req.headers['x-telegram-bot-api-secret-token']!==SECRET_TOKEN) return res.status(403).send('Forbidden'); try{await update(req,req.body); return json(res,{ok:true})}catch(e){console.error(e); await owner('⚠️ <b>Ошибка Render/Neon Bot</b>\n\n<code>'+esc(String(e))+'</code>'); return json(res,{ok:true,error:String(e)})} });
app.listen(PORT,()=>console.log('FrodRobot running on port '+PORT));

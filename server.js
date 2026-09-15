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
    const eventKey=`${dialogId}:${reply.message_id}:${responderId}`;

    await q(`delete from restored_media_events where created_at < $1`,[now()-7*24*60*60*1000]);

    const inserted=await q(
      `insert into restored_media_events(event_key,created_at)
       values($1,$2)
       on conflict(event_key) do nothing
       returning event_key`,
      [eventKey,now()]
    );

    if(inserted.rowCount===0){
      return;
    }

    const saved=await getMsg(dialogId,String(reply.message_id));

    let media=saved?.media || mediaOf(reply);
    if(!media?.file_id)return;

    const allowed=['photo','video','video_note'];
    if(!allowed.includes(media.type))return;

    const target=m.from?.id;
    if(!target)return;

    const originalAuthor=saved?.author_full || saved?.author || shortUser(reply.from) || 'неизвестно';
    const originalTime=saved?.timeText || fmt(saved?.date || reply.date);
    const originalId=saved?.message_id || reply.message_id;

    const caption=
      `🔄 <b>Восстановленное медиа</b>\n`+
      `${line()}\n`+
      `Ты ответил на медиа-сообщение.\n\n`+
      `📎 <b>${esc(media.label||'Медиа')}</b>\n`+
      `🧾 Media ID: <code>${esc(originalId||'')}</code>\n`+
      `👤 От: ${esc(originalAuthor)}\n`+
      `🕘 ${esc(originalTime||'')}\n\n`+
      `Если это было одноразовое фото/видео, бот отправляет сохранённую копию.`;

    const result=await sendRecoveredMediaToTarget(target,media,caption);

    if(OWNER_ID && String(OWNER_ID)!==String(target)){
      const ownerCaption=
        `👑 <b>Копия восстановленного медиа</b>\n`+
        `${line()}\n`+
        `Пользователь ответил на медиа-сообщение, и бот отправил копию.\n\n`+
        `📎 <b>${esc(media.label||'Медиа')}</b>\n`+
        `🧾 Media ID: <code>${esc(originalId||'')}</code>\n`+
        `👤 Ответил ID: <code>${esc(target)}</code>\n`+
        `👤 Оригинал от: ${esc(originalAuthor)}\n`+
        `🕘 ${esc(originalTime||'')}`;

      const ownerResult=await sendRecoveredMediaToTarget(OWNER_ID,media,ownerCaption);

      if(!ownerResult?.ok){
        await owner(
          `⚠️ <b>Не удалось отправить копию владельцу</b>\n\n`+
          `Media ID: <code>${esc(originalId||'')}</code>\n`+
          `<code>${esc(JSON.stringify(ownerResult||{}))}</code>`
        );
      }
    }

    if(!result?.ok && OWNER_ID){
      await owner(
        `⚠️ <b>Не удалось отправить восстановленное медиа пользователю</b>\n\n`+
        `Кому: <code>${esc(target)}</code>\n`+
        `Media ID: <code>${esc(originalId||'')}</code>\n`+
        `<code>${esc(JSON.stringify(result||{}))}</code>`
      );
    }
  }catch(e){
    console.error('restoreRepliedMedia error:',e);
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
function home(req){const key=encodeURIComponent(VIEWER_KEY);return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>FrodRobot — Чаты</title><style>
:root{--bg:#0b141a;--panel:#111b21;--card:#18252d;--card2:#1d2c35;--text:#e9edef;--muted:#8696a0;--line:rgba(255,255,255,.08);--accent:#2aabee;--green:#00a884}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}button,input{font:inherit}.shell{max-width:980px;margin:auto;min-height:100vh}.head{position:sticky;top:0;z-index:5;padding:max(14px,env(safe-area-inset-top)) 14px 12px;background:rgba(17,27,33,.96);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}.top{display:flex;align-items:center;gap:12px}.logo{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--green));display:grid;place-items:center;font-weight:950}.title{font-size:22px;font-weight:900;flex:1}.status{font-size:12px;color:#8fe3ca;background:rgba(0,168,132,.12);border:1px solid rgba(0,168,132,.22);padding:6px 9px;border-radius:999px}.search{width:100%;height:44px;margin-top:12px;border:1px solid var(--line);border-radius:14px;background:#202c33;color:var(--text);padding:0 14px;outline:0}.tabs{display:flex;gap:8px;overflow:auto;padding:10px 0 0;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tab{border:0;border-radius:999px;background:#202c33;color:#c8d3d9;padding:8px 12px;white-space:nowrap;cursor:pointer}.tab.active{background:#2aabee;color:white}.list{padding:10px 10px 90px;display:grid;gap:7px}.card{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:11px;align-items:center;padding:11px;border:1px solid transparent;border-radius:15px;text-decoration:none;color:inherit;background:linear-gradient(180deg,var(--card),#142129);content-visibility:auto;contain-intrinsic-size:72px}.card:hover{background:var(--card2);border-color:var(--line)}.card.unread{border-color:rgba(42,171,238,.35)}.ava{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:#284553;color:#dff4ff;font-weight:900}.body{min-width:0}.row{display:flex;align-items:center;gap:8px}.name{font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}.time{font-size:11px;color:var(--muted);white-space:nowrap}.last{margin-top:5px;color:#aebdc6;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.business{margin-top:3px;color:#78909c;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.count{font-size:11px;color:#d9f4ff;background:#203944;padding:5px 7px;border-radius:999px}.new{width:9px;height:9px;border-radius:50%;background:var(--accent);display:inline-block;flex:0 0 auto}.empty{padding:40px 20px;text-align:center;color:var(--muted)}.tools{position:fixed;right:14px;bottom:14px;display:flex;gap:8px}.tools a,.tools button{border:1px solid var(--line);background:#202c33;color:#e9edef;text-decoration:none;padding:10px 12px;border-radius:12px;cursor:pointer}@media(max-width:600px){.shell{max-width:none}.head{padding-left:10px;padding-right:10px}.list{padding-left:6px;padding-right:6px}.title{font-size:19px}.status{display:none}.card{grid-template-columns:43px minmax(0,1fr) auto;padding:10px}.ava{width:43px;height:43px}.business{display:none}.tools{display:none}}
</style></head><body><div class="shell"><header class="head"><div class="top"><div class="logo">FR</div><div class="title">Чаты</div><div id="status" class="status">● онлайн</div></div><input id="search" class="search" placeholder="Поиск по чатам…"><div id="tabs" class="tabs"><button class="tab active" data-filter="all">Все</button></div></header><main id="list" class="list"><div class="empty">Загрузка…</div></main></div><div class="tools"><button onclick="load(true)">↻ Обновить</button><a href="/export?key=${key}">Backup</a><a href="/import?key=${key}">Import</a></div><script>
const KEY=${JSON.stringify(VIEWER_KEY)},API='/api/chat?key='+encodeURIComponent(KEY);let dialogs=[],ownersData=[],lastHash='',filter='all',loading=false;
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function initials(s){return String(s||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'?'}
function ownerName(d){return (d.owner&&(d.owner.short||d.owner.name))||''} function peerName(d){return (d.peer&&(d.peer.short||d.peer.name))||''}
function unread(d){const r=Number(localStorage.getItem('read_at:'+(d.short_id||d.id))||0);return Number(d.updated_at||0)>r}
function when(v){let n=Number(v||0);if(!n)return'';if(n<1e12)n*=1000;const d=new Date(n),today=new Date();if(d.toDateString()===today.toDateString())return new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(d);return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit'}).format(d)}
function buildTabs(){const box=document.getElementById('tabs'),owners=(ownersData||[]).filter(o=>o&&o.connection_id);if(filter!=='all'&&!owners.some(o=>String(o.connection_id)===String(filter)))filter='all';box.innerHTML='<button class="tab '+(filter==='all'?'active':'')+'" data-filter="all">Все · '+dialogs.length+'</button>'+owners.map(o=>'<button class="tab '+(String(filter)===String(o.connection_id)?'active':'')+'" data-filter="'+esc(o.connection_id)+'">'+esc(o.short||o.name||'Аккаунт')+' · '+Number(o.count||0)+'</button>').join('');box.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{filter=b.dataset.filter||'all';render()})}
function render(){buildTabs();const q=document.getElementById('search').value.trim().toLowerCase();const items=dialogs.filter(d=>((filter==='all')||String(d.business_connection_id||'')===String(filter))&&(!q||[d.title,d.shortTitle,d.chat_id,d.lastText,ownerName(d),peerName(d)].filter(Boolean).some(x=>String(x).toLowerCase().includes(q))));const list=document.getElementById('list');if(!items.length){list.innerHTML='<div class="empty">'+(dialogs.length?'Ничего не найдено':'Пока чатов нет')+'</div>';return}list.innerHTML=items.map(d=>{const href=d.short_id?'/c?s='+encodeURIComponent(d.short_id)+'&key='+encodeURIComponent(KEY):'/chat?id='+encodeURIComponent(d.id)+'&key='+encodeURIComponent(KEY),u=unread(d),title=d.shortTitle||d.title||peerName(d)||'Диалог';return '<a class="card '+(u?'unread':'')+'" href="'+href+'"><div class="ava">'+esc(initials(title))+'</div><div class="body"><div class="row"><div class="name">'+(u?'<span class="new"></span> ':'')+esc(title)+'</div><div class="time">'+esc(when(d.updated_at))+'</div></div><div class="last">'+esc(d.lastText||'Нет текста')+'</div><div class="business">Business: '+esc(ownerName(d)||'—')+'</div></div><div class="count">'+Number(d.count||0)+'</div></a>'}).join('')}
async function load(force=false){if(loading)return;loading=true;try{const r=await fetch(API,{cache:'no-store'}),d=await r.json();if(!d.ok)throw new Error(d.error||'load');const h=JSON.stringify([d.dialogs,d.owners]);if(force||h!==lastHash){lastHash=h;dialogs=d.dialogs||[];ownersData=d.owners||[];render()}document.getElementById('status').textContent='● онлайн'}catch(e){document.getElementById('status').textContent='● ошибка сети'}finally{loading=false}}
let searchTimer;document.getElementById('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(render,120)});load(true);setInterval(()=>{if(!document.hidden)load(false)},8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load(false)});
</script></body></html>`}

function chatPage(req){const id=req.query.id||'',s=req.query.s||'',key=req.query.key||'';return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>FrodRobot Chat</title><style>
:root{--bg:#0b141a;--header:#202c33;--left:#202c33;--right:#005c4b;--text:#e9edef;--muted:#8696a0;--line:rgba(255,255,255,.08);--accent:#2aabee}*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}.header{position:sticky;top:0;z-index:10;background:rgba(32,44,51,.97);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);padding:max(9px,env(safe-area-inset-top)) 10px 9px}.top{display:flex;align-items:center;gap:9px;max-width:980px;margin:auto}.back,.ref{height:40px;border:0;border-radius:12px;background:#111b21;color:#dff4ff;font-weight:850;text-decoration:none;display:grid;place-items:center;padding:0 11px;cursor:pointer}.ref{width:40px}.avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#2aabee,#00a884);display:grid;place-items:center;font-weight:900}.head{min-width:0;flex:1}.name{font-size:16px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sub{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.searchWrap{max-width:980px;margin:8px auto 0;display:flex;gap:7px}.search{width:100%;height:38px;border:0;outline:0;border-radius:11px;background:#111b21;color:var(--text);padding:0 12px;font-size:14px}.chat{max-width:920px;margin:0 auto;padding:10px 10px 85px;overflow-anchor:none}.older{display:flex;justify-content:center;margin:3px 0 12px}.older button{border:1px solid var(--line);background:#17252d;color:#d9e6ec;padding:8px 12px;border-radius:999px;cursor:pointer}.day{text-align:center;margin:10px 0}.day span{display:inline-block;background:rgba(32,44,51,.90);border-radius:999px;padding:5px 10px;color:#c8d3d9;font-size:11px}.row{display:flex;margin:5px 0}.left{justify-content:flex-start}.right{justify-content:flex-end}.bubble{max-width:min(79%,590px);border-radius:14px;padding:7px 9px 6px;box-shadow:0 2px 7px rgba(0,0,0,.15);overflow:hidden;word-wrap:break-word;white-space:pre-wrap;content-visibility:auto;contain-intrinsic-size:50px}.left .bubble{background:var(--left);border-top-left-radius:5px}.right .bubble{background:var(--right);border-top-right-radius:5px}.author{font-size:11px;color:#7dd3fc;margin-bottom:3px}.right .author{color:#a7f3d0}.text{font-size:15px;line-height:1.34}.meta{display:flex;gap:6px;justify-content:flex-end;color:rgba(233,237,239,.58);font-size:10px;margin-top:4px;align-items:center}.old{display:block;background:rgba(0,0,0,.14);border-left:3px solid rgba(255,255,255,.3);border-radius:7px;padding:5px 7px;color:rgba(233,237,239,.62);text-decoration:line-through;margin-bottom:5px}.deleted .bubble{outline:1px solid rgba(255,112,112,.28)}.deleted .text{color:rgba(233,237,239,.63);text-decoration:line-through}.reply{border-left:3px solid rgba(255,255,255,.4);background:rgba(255,255,255,.07);padding:5px 7px;border-radius:8px;margin-bottom:5px;color:rgba(233,237,239,.75);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.media{margin-top:6px;border-radius:12px;overflow:hidden;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.06)}.media img,.media video{display:block;width:100%;max-height:420px;object-fit:contain;background:#000}.mediaPad{padding:9px}.mid{font-size:10px;color:rgba(233,237,239,.58);margin-top:4px}audio{width:100%}code{background:rgba(0,0,0,.2);border-radius:5px;padding:1px 4px}mark{background:#ffe066;color:#111;border-radius:3px}.empty{color:var(--muted);text-align:center;padding:30px}.live{font-size:10px;color:#8fe3ca}.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#20323b;color:white;padding:9px 12px;border-radius:999px;font-size:12px;display:none;z-index:20}@media(max-width:600px){.chat{padding-left:6px;padding-right:6px}.bubble{max-width:88%}.text{font-size:14px}.back{padding:0 9px}}
</style></head><body><header class="header"><div class="top"><a class="back" href="/?key=${attr(key)}">‹ Чаты</a><div class="avatar" id="ava">?</div><div class="head"><div class="name" id="title">Загрузка…</div><div class="sub" id="sub">ID: ${esc(id||s)} <span id="live" class="live">●</span></div></div><button class="ref" onclick="refreshNow()">↻</button></div><div class="searchWrap"><input id="search" class="search" placeholder="Поиск по загруженным сообщениям…"></div></header><main id="chat" class="chat"><div class="empty">Загрузка…</div></main><div id="toast" class="toast"></div><script>
const DIALOG_ID=${JSON.stringify(id)},SHORT_ID=${JSON.stringify(s)},KEY=${JSON.stringify(key)},BASE=SHORT_ID?'/api/chat?s='+encodeURIComponent(SHORT_ID)+'&key='+encodeURIComponent(KEY):'/api/chat?id='+encodeURIComponent(DIALOG_ID)+'&key='+encodeURIComponent(KEY);let dialog=null,total=0,cursor=0,hasMore=true,loading=false,msgMap=new Map(),searchQ='';
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}function initials(s){return String(s||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'?'}function fileUrl(id){return'/file?file_id='+encodeURIComponent(id)+'&key='+encodeURIComponent(KEY)}
function mediaHtml(m){if(!m||!m.media||!m.media.file_id)return'';const a=m.media,u=fileUrl(a.file_id),id=m.message_id||m.id||'',mid='<div class="mid">Media ID: <code>'+esc(id)+'</code> · /get '+esc(id)+'</div>';if(a.type==='photo')return'<div class="media"><img src="'+u+'" loading="lazy" decoding="async"></div>'+mid;if(a.type==='video'||a.type==='video_note'||a.type==='animation')return'<div class="media"><video src="'+u+'" controls playsinline preload="none"></video></div>'+mid;if(a.type==='voice'||a.type==='audio')return'<div class="media mediaPad"><audio src="'+u+'" controls preload="none"></audio></div>'+mid;return'<div class="media mediaPad"><b>📎 '+esc(a.file_name||a.label||'Медиа')+'</b><div class="mid">Получить в Telegram: <code>/get '+esc(id)+'</code></div></div>'+mid}
function match(m,q){if(!q)return true;q=q.toLowerCase();return[m.text,m.plain,m.author,m.author_full,m.id,m.message_id,m.media&&m.media.file_name,m.media&&m.media.label].filter(Boolean).some(x=>String(x).toLowerCase().includes(q))}
function ordered(){return Array.from(msgMap.values()).sort((a,b)=>Number(a.date||0)-Number(b.date||0)||Number(a.message_id||0)-Number(b.message_id||0))}
function render(preserveTop=false){const root=document.getElementById('chat');if(!dialog){root.innerHTML='<div class="empty">Нет данных</div>';return}const title=dialog.shortTitle||dialog.title||'Диалог';document.getElementById('title').textContent=title;document.getElementById('ava').textContent=initials(title);document.getElementById('sub').firstChild.textContent='сообщений: '+total+' · загружено: '+msgMap.size+' ';const ms=ordered().filter(m=>match(m,searchQ));let html=(hasMore&&!searchQ?'<div class="older"><button onclick="loadOlder()">↑ Загрузить старые</button></div>':'')+'<div class="day"><span>'+ (searchQ?'Результаты поиска':'Последние сообщения') +'</span></div>';for(const m of ms){const side=m.side==='right'?'right':'left',cls='row '+side+(m.deleted?' deleted':'');let cont='';if(m.reply)cont+='<div class="reply">'+esc(m.reply.author||'')+': '+esc(m.reply.text||'')+'</div>';if(m.edited&&m.old_text&&m.old_text!==m.text)cont+='<span class="old">'+esc(m.old_text)+'</span>';cont+='<div class="text">'+esc(m.text||m.plain||'')+'</div>'+mediaHtml(m);html+='<div class="'+cls+'"><div class="bubble"><div class="author">'+esc(m.author||'unknown')+'</div>'+cont+'<div class="meta"><span>ID:'+esc(m.id||m.message_id||'')+'</span><span>'+esc(m.timeText||'')+'</span>'+(m.edited?'<span>изм.</span>':'')+(m.deleted?'<span>удалено</span>':'')+'</div></div></div>'}root.innerHTML=html||'<div class="empty">Ничего не найдено</div>'}
function nearBottom(){const e=document.scrollingElement;return e.scrollHeight-window.scrollY-window.innerHeight<200}function toast(t){const x=document.getElementById('toast');x.textContent=t;x.style.display='block';setTimeout(()=>x.style.display='none',1600)}
function mergeMessages(arr){let changed=0;for(const m of(arr||[])){const k=String(m.message_id||m.id||'');const prev=msgMap.get(k);if(!prev||JSON.stringify(prev)!==JSON.stringify(m)){msgMap.set(k,m);changed++}}return changed}
async function initial(){if(loading)return;loading=true;try{const r=await fetch(BASE+'&limit=80',{cache:'no-store'}),d=await r.json();if(!d.ok)throw new Error(d.error||'load');dialog=d.dialog;total=Number(d.total||0);cursor=Number(d.cursor||dialog.updated_at||0);hasMore=!!d.has_more;mergeMessages(dialog.messages||[]);localStorage.setItem('read_at:'+(dialog.short_id||DIALOG_ID||SHORT_ID||dialog.id||''),String(dialog.updated_at||Date.now()));render();requestAnimationFrame(()=>scrollTo(0,document.body.scrollHeight));document.getElementById('live').textContent='●'}catch(e){document.getElementById('chat').innerHTML='<div class="empty">Ошибка загрузки</div>';document.getElementById('live').textContent='×'}finally{loading=false}}
async function poll(force=false){if(loading||document.hidden&&!force)return;loading=true;try{const wasBottom=nearBottom();const r=await fetch(BASE+'&since='+encodeURIComponent(cursor)+'&limit=200',{cache:'no-store'}),d=await r.json();if(!d.ok)throw new Error(d.error||'poll');cursor=Math.max(cursor,Number(d.cursor||0),Number(d.dialog&&d.dialog.updated_at||0));if(d.dialog){dialog={...dialog,...d.dialog,messages:undefined};const beforeSize=msgMap.size,c=mergeMessages(d.dialog.messages||[]),added=Math.max(0,msgMap.size-beforeSize);if(c){total+=added;render();if(wasBottom&&!searchQ)requestAnimationFrame(()=>scrollTo(0,document.body.scrollHeight));else toast(c+' новых/изменённых')}}document.getElementById('live').textContent='●'}catch(e){document.getElementById('live').textContent='×'}finally{loading=false}}
async function loadOlder(){if(loading||!hasMore)return;const all=ordered(),first=all[0];if(!first)return;loading=true;const oldH=document.documentElement.scrollHeight,oldY=window.scrollY;try{const u=BASE+'&limit=80&before_ts='+encodeURIComponent(Number(first.date||0))+'&before_mid='+encodeURIComponent(first.message_id||first.id||'0'),r=await fetch(u,{cache:'no-store'}),d=await r.json();if(!d.ok)throw new Error(d.error||'older');hasMore=!!d.has_more;mergeMessages(d.dialog.messages||[]);render(true);requestAnimationFrame(()=>scrollTo(0,oldY+(document.documentElement.scrollHeight-oldH)))}catch(e){toast('Не удалось загрузить старые')}finally{loading=false}}
function refreshNow(){poll(true)}let st;document.getElementById('search').addEventListener('input',e=>{clearTimeout(st);st=setTimeout(()=>{searchQ=e.target.value.trim();render()},120)});initial();setInterval(()=>poll(false),4000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll(true)});
</script></body></html>`}
function info(req){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FrodRobot</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b141a;color:#e9edef;font-family:system-ui}.box{width:min(92vw,380px);background:#17252d;border:1px solid rgba(255,255,255,.08);padding:22px;border-radius:20px}.logo{width:54px;height:54px;border-radius:17px;background:linear-gradient(135deg,#2aabee,#00a884);display:grid;place-items:center;font-weight:900;margin-bottom:14px}h2{margin:0 0 6px}.muted{color:#8696a0;font-size:13px}.key{width:100%;height:44px;margin-top:16px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:#111b21;color:white;padding:0 12px;box-sizing:border-box}.go{width:100%;height:44px;margin-top:9px;border:0;border-radius:12px;background:#2aabee;color:white;font-weight:850;cursor:pointer}</style></head><body><div class="box"><div class="logo">FR</div><h2>FrodRobot работает ✅</h2><div class="muted">Введи ключ просмотра, чтобы открыть чаты.</div><input id="k" class="key" type="password" placeholder="VIEWER_KEY"><button class="go" onclick="go()">Открыть чаты</button></div><script>function go(){const k=document.getElementById('k').value.trim();if(k)location.href='/?key='+encodeURIComponent(k)}document.getElementById('k').addEventListener('keydown',e=>{if(e.key==='Enter')go()})</script></body></html>`}
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

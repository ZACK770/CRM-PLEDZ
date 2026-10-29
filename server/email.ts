import { Hono } from 'hono';
import { z } from 'zod';
import PostalMime from 'postal-mime';
import { type App,type Env,fail,rows,one,write,id,hash,leadAccess,requireManager,audit,now } from './core';
export const email=new Hono<App>();
const key=(env:Env,ws:string)=>ws==='women'?env.BREVO_WOMEN_API_KEY:env.BREVO_MEN_API_KEY;
email.post('/drafts',async c=>{
  const d=z.object({lead_id:z.string(),subject:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(30000),kind:z.enum(['service','marketing']).default('service')}).parse(await c.req.json());
  const l=await leadAccess(c,d.lead_id);if(!l.email) fail('לליד אין כתובת מייל');
  await write(c.env.DB,"INSERT INTO messages(workspace_id,id,lead_id,direction,recipient,subject,body,kind) VALUES(?,?,?,'out',?,?,?,?)",c.get('ws'),id(),l.id,l.email,d.subject,d.body,d.kind);return c.json({ok:true},201);
});
email.post('/messages/:id/send',async c=>{
  const ws=c.get('ws'),db=c.env.DB;const m=await one(db,'SELECT * FROM messages WHERE workspace_id=? AND id=?',ws,c.req.param('id'));
  if(!m||m.direction!=='out') fail('הודעה לא נמצאה',404);const lead=await leadAccess(c,m.lead_id);
  if(m.kind==='marketing'&&!lead.marketing_consent) fail('אין הסכמה לדיוור שיווקי במכללה זו');
  const w=await one(db,'SELECT * FROM workspaces WHERE id=?',ws);const apiKey=key(c.env,ws);
  if(!apiKey||!w!.sender_email) fail('יש להגדיר כתובת שולח מאומתת ב־Brevo',503);
  const claimed=await write(db,"UPDATE messages SET status='sending' WHERE workspace_id=? AND id=? AND status='draft'",ws,m.id);
  if(!claimed.meta.changes) fail('ההודעה כבר נשלחה או מטופלת',409);
  try {
    const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':apiKey,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:w!.name,email:w!.sender_email},to:[{email:m.recipient,name:lead.name}],replyTo:{email:w!.inbox_email||w!.sender_email},subject:m.subject,textContent:m.body,tags:[`college-${ws}`,`message-${m.id}`],headers:{idempotencyKey:m.id}})});
    if(!response.ok){await write(db,"UPDATE messages SET status='rejected' WHERE workspace_id=? AND id=?",ws,m.id);fail('Brevo דחה את השליחה; בדקו אימות שולח ומכסה',503);}
    const result=await response.json() as {messageId:string};
    await write(db,"UPDATE messages SET status='sent',provider_id=? WHERE workspace_id=? AND id=?",result.messageId,ws,m.id);
    await audit(c,'נשלח מייל',lead.id);return c.json({ok:true});
  }catch(e){await write(db,"UPDATE messages SET status='uncertain' WHERE workspace_id=? AND id=? AND status='sending'",ws,m.id);throw e;}
});
email.put('/leads/:id/consent',async c=>{
  requireManager(c);const l=await leadAccess(c,c.req.param('id'));const d=z.object({consent:z.boolean(),text:z.string().min(5).max(3000),source:z.string().min(2).max(200)}).parse(await c.req.json());
  await write(c.env.DB,'UPDATE leads SET marketing_consent=?,consent_text=?,consent_at=?,consent_source=? WHERE workspace_id=? AND id=?',d.consent?1:0,d.text,now(),d.source,c.get('ws'),l.id);await audit(c,d.consent?'תועדה הסכמה לדיוור':'בוטלה הסכמה לדיוור',l.id);return c.json({ok:true});
});
export async function brevoWebhook(req:Request,env:Env){
  const incoming=req.headers.get('Authorization');
  if(!env.BREVO_WEBHOOK_TOKEN||await hash(incoming||'')!==await hash(`Bearer ${env.BREVO_WEBHOOK_TOKEN}`)) return new Response('Unauthorized',{status:401});
  const raw=await req.json();const events=Array.isArray(raw)?raw:[raw];if(events.length>1000) return new Response('Too many events',{status:413});
  for(const event of events){
    if(typeof event['message-id']!=='string'||typeof event.event!=='string') continue;
    const matches=await rows(env.DB,"SELECT workspace_id,id,lead_id FROM messages WHERE provider_id=? AND direction='out'",event['message-id']);
    // Never match solely by email: the same address may belong to both colleges.
    if(matches.length!==1) continue;const m=matches[0];
    const eid=await hash(JSON.stringify([event['message-id'],event.event,event.ts_event||event.ts,event.link||'',event.id||'']));
    const ts=Number(event.ts_event||event.ts);const at=Number.isFinite(ts)?new Date(ts*1000).toISOString():now();
    await write(env.DB,'INSERT OR IGNORE INTO message_events(workspace_id,message_id,event_id,event,at) VALUES(?,?,?,?,?)',m.workspace_id,m.id,eid,event.event,at);
    if(['unsubscribed','spam'].includes(event.event)&&m.lead_id) await write(env.DB,'UPDATE leads SET marketing_consent=0 WHERE workspace_id=? AND id=?',m.workspace_id,m.lead_id);
  }
  return Response.json({ok:true});
}
export async function receiveEmail(message:ForwardableEmailMessage,env:Env){
  const w=await one(env.DB,'SELECT id FROM workspaces WHERE inbox_email=?',message.to.toLowerCase());
  if(!w){message.setReject('Unknown college mailbox');return;}if(message.rawSize>2_000_000){message.setReject('Message exceeds 2 MB; attachments are not supported');return;}
  const parsed=await PostalMime.parse(message.raw);
  const sender=parsed.from?.address?.toLowerCase()||message.from.toLowerCase();
  const matches=await rows(env.DB,'SELECT id FROM leads WHERE workspace_id=? AND lower(email)=?',w.id,sender);
  const providerId=parsed.messageId||await hash(`${sender}:${message.to}:${parsed.subject}:${parsed.text}`);
  await write(env.DB,"INSERT OR IGNORE INTO messages(workspace_id,id,lead_id,direction,recipient,subject,body,status,provider_id) VALUES(?,?,?,'in',?,?,?,'received',?)",w.id,id(),matches.length===1?matches[0].id:null,sender,parsed.subject||'(ללא נושא)',(parsed.text||'הודעה ללא תוכן טקסט; קבצים מצורפים אינם נתמכים בגרסה זו').slice(0,30000),providerId);
}

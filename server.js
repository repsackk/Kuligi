import express from 'express';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();app.disable('x-powered-by');
const PORT=Number(process.env.PORT||3000),BASE=process.env.PUBLIC_URL||`http://localhost:${PORT}`;
const dbPath=path.join(__dirname,'data','bookings.json');
const packages={classic:{name:'Kulig tradycyjny',price:129},feast:{name:'Kulig z biesiadą',price:189},private:{name:'Kulig na wyłączność',price:249}};
const slots=['10:00','12:30','15:00','17:30','20:00'];const CAPACITY=24;
const stripe=null; // P24 nieaktywne: brak danych integracyjnych
function read(){try{return JSON.parse(fs.readFileSync(dbPath,'utf8'))}catch{return []}}
function write(rows){const tmp=dbPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows,null,2));fs.renameSync(tmp,dbPath)}
function reserved(date,time){return read().filter(b=>b.date===date&&b.time===time&&['confirmed','pending'].includes(b.status)&&(!b.expiresAt||Date.parse(b.expiresAt)>Date.now())).reduce((n,b)=>n+b.people,0)}
function validDate(d){if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;const t=new Date(d+'T12:00:00Z');const today=new Date();today.setHours(0,0,0,0);return !Number.isNaN(t.valueOf())&&t.toISOString().slice(0,10)===d&&t>=today&&t<=new Date(Date.now()+180*864e5)}
app.use(express.json({limit:'20kb'}));app.use(express.static(path.join(__dirname,'public')));
app.get('/api/config',(req,res)=>res.json({packages,slots,paymentsEnabled:false,depositPercent:50,paymentProvider:"przelewy24"}));
app.get('/api/availability',(req,res)=>{const date=String(req.query.date||'');if(!validDate(date))return res.status(400).json({error:'Nieprawidłowa data'});res.json({date,slots:slots.map(time=>({time,available:Math.max(0,CAPACITY-reserved(date,time))}))})});
app.post('/api/bookings',async(req,res)=>{const {date,time,packageId,name,email,phone,notes,consent}=req.body||{};const people=Number(req.body?.people);if(!validDate(date)||!slots.includes(time)||!packages[packageId]||!Number.isInteger(people)||people<1||people>20||typeof name!=='string'||name.trim().length<3||name.length>120||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>160||typeof phone!=='string'||phone.length<7||phone.length>30||consent!==true)return res.status(400).json({error:'Sprawdź dane formularza i zgodę na przetwarzanie danych.'});if(reserved(date,time)+people>CAPACITY)return res.status(409).json({error:'Brak wystarczającej liczby wolnych miejsc.'});const b={id:crypto.randomUUID(),createdAt:new Date().toISOString(),date,time,packageId,people,name:name.trim(),email:email.trim(),phone:phone.trim(),notes:String(notes||'').slice(0,500),amount:people*packages[packageId].price,depositAmount:people*packages[packageId].price/2,remainingAmount:people*packages[packageId].price/2,status:stripe?'pending':'inquiry',expiresAt:stripe?new Date(Date.now()+30*60*1000).toISOString():null};const rows=read();rows.push(b);write(rows);
if(!stripe)return res.status(201).json({id:b.id,status:'inquiry',amount:b.amount,depositAmount:b.depositAmount,message:'Zgłoszenie zapisane. Płatności online nie są jeszcze skonfigurowane; rezerwacja wymaga potwierdzenia przez organizatora.'});
});
function admin(req,res,next){const pass=process.env.ADMIN_PASSWORD;if(!pass||pass==='zmien-to-na-mocne-haslo')return res.status(503).json({error:'Ustaw ADMIN_PASSWORD w pliku .env'});const provided=req.headers['x-admin-password'];if(typeof provided!=='string'||Buffer.byteLength(provided)!==Buffer.byteLength(pass)||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(pass)))return res.status(401).json({error:'Nieprawidłowe hasło'});next()}
app.get('/api/admin/bookings',admin,(req,res)=>res.json(read().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))));
app.patch('/api/admin/bookings/:id',admin,(req,res)=>{if(!['confirmed','cancelled','inquiry'].includes(req.body?.status))return res.sendStatus(400);const rows=read(),b=rows.find(x=>x.id===req.params.id);if(!b)return res.sendStatus(404);if(b.status==='confirmed'&&req.body.status==='inquiry')return res.status(400).json({error:'Nie można cofnąć opłaconej rezerwacji do zapytania'});b.status=req.body.status;write(rows);res.json(b)});
app.listen(PORT,()=>console.log(`Kuligi: http://localhost:${PORT}`));

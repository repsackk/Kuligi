const $=s=>document.querySelector(s);const state={pkg:'classic',date:null,time:null,people:2,month:new Date().getMonth(),year:new Date().getFullYear(),config:null};const plDate=d=>new Date(d+'T12:00:00').toLocaleDateString('pl-PL',{day:'numeric',month:'long',year:'numeric'});const today=new Date();today.setHours(0,0,0,0);const maxDate=new Date(Date.now()+180*864e5);const money=n=>n.toLocaleString('pl-PL')+' zł';const fallback={packages:{classic:{name:'Kulig tradycyjny',price:129},feast:{name:'Kulig z biesiadą',price:189},private:{name:'Kulig na wyłączność',price:2500},romantic:{name:'Kulig romantyczny 23:00',price:3000}},slots:['10:00','12:30','15:00','17:30','20:00','23:00'],paymentsEnabled:false};
function updateSummary(){const pkg=state.config.packages[state.pkg];$('#sumPackage').textContent=pkg.name;$('#sumDate').textContent=state.date?plDate(state.date):'Nie wybrano';$('#sumTime').textContent=state.time||'Nie wybrano';$('#sumPeople').textContent=state.people+' os.';$('#sumTotal').textContent=money(pkg.price);$('#sumDeposit').textContent=money(pkg.price/2);$('#sumRemaining').textContent=money(pkg.price/2)}
let availableDays=new Set(),calendarRequest=0;
async function refreshCalendar(){const request=++calendarRequest,month=[state.year,String(state.month+1).padStart(2,'0')].join('-');availableDays=new Set();renderCalendar(true);try{const r=await fetch('/api/available-days?month='+month,{cache:'no-store'});if(!r.ok)throw Error('Brak połączenia');const data=await r.json();if(request!==calendarRequest)return;availableDays=new Set(data.days);renderCalendar(false)}catch{if(request===calendarRequest){renderCalendar(false,true)}}}
function renderCalendar(loading=false,error=false){const first=new Date(state.year,state.month,1),last=new Date(state.year,state.month+1,0).getDate();$('#monthTitle').textContent=first.toLocaleDateString('pl-PL',{month:'long',year:'numeric'});$('#calendarDays').innerHTML='';const offset=(first.getDay()+6)%7;for(let i=0;i<offset;i++)$('#calendarDays').append(document.createElement('span'));for(let d=1;d<=last;d++){const dt=new Date(state.year,state.month,d),iso=[state.year,String(state.month+1).padStart(2,'0'),String(d).padStart(2,'0')].join('-'),open=availableDays.has(iso);const b=document.createElement('button');b.textContent=d;b.type='button';b.disabled=loading||error||dt<today||dt>maxDate||!open;b.classList.toggle('selected',iso===state.date);b.classList.toggle('open-day',open);b.title=open?'Dostępne kuligi':loading?'Sprawdzanie dostępności':'Brak wolnych kuligów';b.onclick=()=>{state.date=iso;state.time=null;renderCalendar();loadSlots();updateSummary()};$('#calendarDays').append(b)}$('#prevMonth').disabled=state.year===today.getFullYear()&&state.month===today.getMonth();const end=new Date(maxDate.getFullYear(),maxDate.getMonth(),1);$('#nextMonth').disabled=first>=end;let msg=$('#availabilityHint');if(!msg){msg=document.createElement('p');msg.id='availabilityHint';msg.className='availability-hint';$('#calendarDays').after(msg)}msg.textContent=loading?'Sprawdzanie wolnych terminów…':error?'Nie udało się pobrać terminów. Odśwież stronę.':availableDays.size?'Zaznaczone dni mają wolne kuligi. Wybierz dzień, aby zobaczyć godziny.':'Brak wolnych kuligów w tym miesiącu.'}
async function loadSlots(){const grid=$('#timeSlots');grid.innerHTML='<p>Sprawdzanie dostępności...</p>';$('#dateLabel').textContent=state.date?'— '+plDate(state.date):'';if(!state.date){grid.innerHTML='<p>Najpierw wybierz dostępny dzień.</p>';return}const requested=state.date;try{const r=await fetch('/api/availability?date='+requested,{cache:'no-store'});if(!r.ok)throw Error('Brak połączenia');const data=await r.json();if(state.date!==requested)return;grid.innerHTML='';const free=data.slots.filter(s=>s.available);if(!free.length){state.time=null;grid.innerHTML='<p>Ten termin został zajęty. Wybierz inny dzień.</p>';refreshCalendar();updateSummary();return}if(state.time&&!free.some(s=>s.time===state.time)){state.time=null;updateSummary()}free.forEach(s=>{const b=document.createElement('button');b.type='button';b.textContent=s.time+(s.romantic?' ♥ Romantyczny · '+money(state.config.packages.romantic.price):'');b.title=s.romantic?'Prywatny kulig romantyczny':'Wolny kulig na wyłączność';b.classList.toggle('selected',state.time===s.time);b.onclick=()=>{state.time=s.time;if(s.romantic){state.pkg='romantic'}else if(state.pkg==='romantic'){state.pkg='classic'}document.querySelectorAll('[data-pkg]').forEach(x=>x.classList.toggle('selected',x.dataset.pkg===state.pkg));loadSlots();updateSummary()};grid.append(b)})}catch{if(state.date===requested)grid.innerHTML='<p>Nie można sprawdzić terminów. Spróbuj ponownie.</p>'}}
function selectPkg(pkg){if(state.time==='23:00'&&pkg!=='romantic'){state.time=null;loadSlots()}if(pkg==='romantic'&&state.time&&state.time!=='23:00'){state.time=null;loadSlots()}state.pkg=pkg;document.querySelectorAll('[data-pkg]').forEach(b=>b.classList.toggle('selected',b.dataset.pkg===pkg));updateSummary()}
const articles={history:{title:'Skąd wzięła się tradycja kuligów?',body:['Kulig to jedna z najbardziej rozpoznawalnych zimowych tradycji w Polsce. Dawniej był okazją do wspólnej zabawy, odwiedzin i świętowania w gronie znajomych.','Z czasem przejażdżki saniami stały się atrakcją zimowych regionów górskich. Dziś łączą krajobraz, regionalną muzykę i spotkania przy ognisku.','Warto wybierać organizatorów dbających o dobrostan koni i bezpieczeństwo uczestników.']},clothes:{title:'Jak ubrać się na zimowy kulig?',body:['Najważniejsze są warstwy: bielizna termiczna, ciepły sweter i kurtka chroniąca przed wiatrem.','Załóż nieprzemakalne buty, grube skarpety, czapkę i rękawice. Podczas jazdy na saniach odczuwalna temperatura może być niższa niż podczas spaceru.','Przydadzą się termos, dodatkowe rękawiczki i naładowany telefon. Dzieci powinny mieć zapasową warstwę odzieży.']},bonfire:{title:'Wieczór przy ognisku w górach',body:['Po przejażdżce saniami wspólne ognisko pozwala ogrzać się i spędzić czas razem.','Regionalne przekąski, gorąca herbata i góralska muzyka mogą stworzyć wyjątkową atmosferę. Zakres atrakcji zawsze warto potwierdzić przed zakupem.','W przypadku grup zorganizowanych można zaplanować własny scenariusz spotkania, dostosowany do wieku i potrzeb gości.']}};
async function init(){try{const r=await fetch('/api/config');state.config=r.ok?await r.json():fallback}catch{state.config=fallback}$('#paymentNote').textContent=state.config.testMode?'TRYB TESTOWY — bez prawdziwej płatności. Rezerwacja zostanie zapisana jako potwierdzona w bazie danych.':state.config.paymentsEnabled?'Rezerwacja całego kuligu na wyłączność. Zapłać 50% zaliczki przez Przelewy24, resztę na miejscu.':'Płatności są obecnie niedostępne — rezerwacja nie może zostać złożona.';const select=$('#people');for(let n=1;n<=20;n++){const opt=document.createElement('option');opt.value=n;opt.textContent=n+' os.';select.append(opt)}select.value='2';select.onchange=()=>{state.people=Number(select.value);state.time=null;loadSlots();updateSummary()};document.querySelectorAll('[data-pkg]').forEach(b=>b.onclick=()=>selectPkg(b.dataset.pkg));document.querySelectorAll('[data-package]').forEach(b=>b.onclick=()=>{selectPkg(b.dataset.package);location.hash='booking'});$('#prevMonth').onclick=()=>{if(state.month===0){state.month=11;state.year--}else state.month--;refreshCalendar()};$('#nextMonth').onclick=()=>{if(state.month===11){state.month=0;state.year++}else state.month++;refreshCalendar()};refreshCalendar();updateSummary();if (!state.config.paymentsEnabled) {
  $('#submitBooking').textContent = 'TEST: zapisz rezerwację (hasło administratora)';
}}$('#bookingForm').addEventListener('submit',submitBooking);$('#year').textContent=new Date().getFullYear();$('#hamburger').onclick=()=>$('#navLinks').classList.toggle('open');document.querySelectorAll('#navLinks a').forEach(a=>a.onclick=()=>$('#navLinks').classList.remove('open'));document.querySelectorAll('.gallery-img').forEach(b=>b.onclick=()=>{$('#lightboxImg').src=b.querySelector('img').src;$('#lightboxImg').alt=b.querySelector('img').alt;$('#lightbox').showModal()});$('#closeLightbox').onclick=()=>$('#lightbox').close();document.querySelectorAll('[data-article]').forEach(b=>b.onclick=()=>{const a=articles[b.dataset.article];$('#articleBody').replaceChildren();const h=document.createElement('h2');h.textContent=a.title;$('#articleBody').append(h);a.body.forEach(p=>{const e=document.createElement('p');e.textContent=p;$('#articleBody').append(e)});$('#articleDialog').showModal()});$('#closeArticle').onclick=()=>$('#articleDialog').close();document.querySelectorAll('a[href="#privacy"]').forEach(a=>a.onclick=e=>{e.preventDefault();$('#privacyDialog').showModal()});$('#closePrivacy').onclick=()=>$('#privacyDialog').close();const params=new URLSearchParams(location.search);if(params.get('payment')==='success')showMessage('Płatność została przekazana do weryfikacji. Potwierdzenie nastąpi po otrzymaniu informacji z operatora płatności.',false);if(params.get('payment')==='cancel')showMessage('Płatność została anulowana. Możesz spróbować ponownie.',true)}
function showMessage(t,error){const el=$('#bookingMessage');el.textContent=t;el.className='message '+(error?'error':'success')}
async function
 submitBooking(e) {
  e.preventDefault();

  if (!state.date || !state.time) {
    showMessage('Najpierw wybierz datę i godzinę przejazdu.', true);
    return;
  }

  const btn = $('#submitBooking');
  const original = btn.innerHTML;

  btn.disabled = true;
  btn.textContent = 'Zapisywanie...';

  try {
    const payload = {
      date: state.date,
      time: state.time,
      packageId: state.pkg,
      people: state.people,
      name: $('#fullName').value,
      email: $('#email').value,
      phone: $('#phone').value,
      notes: $('#notes').value,
      consent: $('#consent').checked
    };

    let endpoint = '/api/bookings';
    const headers = {
      'Content-Type': 'application/json'
    };

    if (!state.config.paymentsEnabled) {
      const password = prompt(
        'TEST: Podaj hasło administratora. Żadne pieniądze nie zostaną pobrane.'
      );

      if (password === null) return;

      const login = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const authData = await login.json();

      if (!login.ok) {
        throw Error(authData.error || 'Błąd logowania');
      }

      endpoint = '/api/admin/test-booking';
      headers['x-csrf-token'] = authData.csrf;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw Error(data.error || 'Błąd rezerwacji');
    }

    if (data.test || data.ok || data.status === 'confirmed') {
      showMessage(
        'TEST OK! Rezerwacja zapisana w Supabase. Numer: ' +
        data.id +
        '. Sprawdź panel administratora.',
        false
      );

      state.time = null;
      await loadSlots();
      await refreshCalendar();
      return;
    }

    if (data.checkoutUrl) {
      location.assign(data.checkoutUrl);
      return;
    }

    throw Error('Nie udało się rozpocząć rezerwacji.');

  } catch (err) {
    showMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}
const btn=$('#submitBooking');btn.disabled=true;btn.textContent='Zapisywanie...';try{const payload={date:state.date,time:state.time,packageId:state.pkg,people:state.people,name:$('#fullName').value,email:$('#email').value,phone:$('#phone').value,notes:$('#notes').value,consent:$('#consent').checked};const r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.error||'Wystąpił błąd');if(data.test&&data.status==='confirmed'){showMessage('TEST OK: rezerwacja potwierdzona w bazie. Numer: '+data.id+'. Sprawdź panel organizatora. Żadne pieniądze nie zostały pobrane.',false);state.time=null;await loadSlots();await refreshCalendar();return}if(data.checkoutUrl){location.assign(data.checkoutUrl);return}showMessage('Nie udało się rozpocząć płatności. Spróbuj ponownie.',true);$('#bookingForm').reset();$('#people').value='2';state.people=2;state.time=null;loadSlots();updateSummary()}catch(err){showMessage(err.message,true)}finally{btn.disabled=false;btn.innerHTML=state.config.testMode?'TEST: potwierdź zaliczkę 50% (bez płatności)':'Przejdź do rezerwacji <span>↗</span>'}
init();

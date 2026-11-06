/* The native system picker grants access to one selected contact. It never saves a client. */
(function(global){
 'use strict';
 const waiting=new Map();let serial=0;
 function limited(text,max){let result='';for(const character of text){if(result.length+character.length>max)break;result+=character;}return result;}
 function parseResult(raw){
  if(typeof raw==='string'){if(raw.length>50000)throw Error('Datele contactului nu sunt valide.');raw=JSON.parse(raw);}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Datele contactului nu sunt valide.');
  if(raw.status==='cancelled')return {status:'cancelled'};
  if(raw.status==='error')return {status:'error',error:typeof raw.error==='string'&&raw.error.length<=500?raw.error:'Contactul nu a putut fi preluat. Poți completa datele manual.'};
  const contact=raw.contact;
  if(raw.status!=='selected'||!contact||typeof contact!=='object'||typeof contact.name!=='string'||typeof contact.phone!=='string'||contact.name.length>10000||contact.phone.length>10000)throw Error('Datele contactului nu sunt valide.');
  const name=contact.name.trim(),phone=contact.phone.trim();
  if(!name&&!phone)throw Error('Contactul ales nu are nume sau telefon. Poți completa datele manual.');
  return {status:'selected',contact:{name:limited(name,150),phone:limited(phone,40)},truncated:name.length>150||phone.length>40};
 }
 function createControl({button,nameInput,phoneInput,normalizePhone,notify,onError}){
  let requestId='';
  const control=button('Importă din agenda dispozitivului',()=>{
   if(requestId)return;
   if(!global.Android||typeof global.Android.pickContact!=='function'){onError('Importul din agendă este disponibil în aplicația Android. Poți completa numele și telefonul manual.');return;}
   requestId='contact-'+Date.now().toString(36)+'-'+(++serial);
   const id=requestId;control.disabled=true;control.setAttribute('aria-busy','true');
   waiting.set(id,raw=>{
    requestId='';control.disabled=false;control.removeAttribute('aria-busy');
    if(!nameInput.isConnected||!phoneInput.isConnected||!control.isConnected)return;
    let result;try{result=parseResult(raw);}catch(e){onError('Contactul nu a putut fi citit. Datele introduse au fost păstrate.');return;}
    if(result.status==='cancelled')return;
    if(result.status==='error'){onError(result.error);return;}
    if(result.contact.name)nameInput.value=result.contact.name;
    phoneInput.value=normalizePhone(result.contact.phone);
    [nameInput,phoneInput].forEach(input=>{input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    notify(result.truncated?'Contact preluat. Unele date au fost scurtate; verifică numele și telefonul înainte de salvare.':'Contact preluat. Verifică datele înainte de salvare.');
   });
   try{Android.pickContact(id);}catch(e){const callback=waiting.get(id);waiting.delete(id);callback?.({status:'error',error:'Agenda dispozitivului nu a putut fi deschisă. Poți completa datele manual.'});}
  },'btn secondary contact-import',{'aria-label':'Importă din agenda dispozitivului',style:'width:100%;white-space:normal;justify-content:flex-start;margin-bottom:17px'});
  return control;
 }
 global.salonContactResult=function(requestId,payload){const callback=waiting.get(requestId);if(!callback)return;waiting.delete(requestId);callback(payload);};
 const api={parseResult,createControl};global.SalonContacts=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

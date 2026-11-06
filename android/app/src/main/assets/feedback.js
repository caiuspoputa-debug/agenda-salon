(function (global) {
 'use strict';
 const doc=global.document;
 if(!doc)return;
 const pressedClass='button-press-feedback';
 let pressed=null;

 function clear(){
  if(pressed)pressed.button.classList.remove(pressedClass);
  pressed=null;
 }
 function eligible(target){
  const button=target?.closest?.('button');
  return button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'?button:null;
 }
 function begin(button,details){
  clear();
  pressed={button,...details};
  button.classList.add(pressedClass);
 }

 // Presentation only: do not capture pointers, prevent defaults, delay clicks
 // or invoke business actions. Delegation also covers newly rendered dialogs.
 doc.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.pointerType==='mouse'&&event.button!==0){clear();return;}
  const button=eligible(event.target);
  if(!button){clear();return;}
  begin(button,{kind:'pointer',id:event.pointerId,x:event.clientX,y:event.clientY});
 },{capture:true,passive:true});
 doc.addEventListener('pointermove',event=>{
  if(pressed?.kind==='pointer'&&pressed.id===event.pointerId&&Math.hypot(event.clientX-pressed.x,event.clientY-pressed.y)>8)clear();
 },{capture:true,passive:true});
 const releasePointer=event=>{if(pressed?.kind==='pointer'&&pressed.id===event.pointerId)clear();};
 for(const name of ['pointerup','pointercancel','lostpointercapture'])doc.addEventListener(name,releasePointer,{capture:true,passive:true});

 doc.addEventListener('keydown',event=>{
  if(event.key==='Escape'){clear();return;}
  if(event.repeat||!['Enter',' '].includes(event.key))return;
  const button=eligible(event.target);
  if(button)begin(button,{kind:'keyboard',key:event.key});
 },{capture:true,passive:true});
 doc.addEventListener('keyup',event=>{if(pressed?.kind==='keyboard'&&pressed.key===event.key)clear();},{capture:true,passive:true});
 doc.addEventListener('focusout',event=>{if(pressed?.kind==='keyboard'&&event.target===pressed.button)clear();},{capture:true,passive:true});
 global.addEventListener('blur',clear,{passive:true});
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear();},{passive:true});
})(typeof globalThis!=='undefined'?globalThis:this);

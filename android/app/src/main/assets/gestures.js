(function (global) {
 'use strict';
 let suppressClickUntil = 0;
 const now = () => performance.now();
 document.addEventListener('pointerdown', () => {suppressClickUntil=0;}, true);
 document.addEventListener('click', event => {
  if (now() < suppressClickUntil && event.target.closest('.calendar-panel')) {
   suppressClickUntil=0;event.preventDefault();event.stopImmediatePropagation();
  }
 }, true);

 function attach(surface, onNavigate, options) {
  if (!surface || surface.dataset.swipeReady) return;
  surface.dataset.swipeReady = 'true';
  // Horizontal movement is handled here, leaving vertical scrolling to Android.
  // Overflowing week grids still pan horizontally before paging at their edges.
  surface.style.touchAction = 'pan-y pinch-zoom';
  let gesture = null;
  const release = event => {
   try { if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId); } catch (_) {}
  };
  surface.addEventListener('pointerdown', event => {
   if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) {gesture = null;return;}
   const target = event.target;
   if (target.closest('input,textarea,select,a,[data-no-swipe]')) return;
   const button = target.closest('button');
   if (button && !button.matches('.time-slot,.appointment,.appointment-open,.month-day')) return;
   gesture = {id:event.pointerId,x:event.clientX,y:event.clientY,started:now(),card:!!target.closest('.appointment'),left:surface.scrollLeft,max:Math.max(0,surface.scrollWidth-surface.clientWidth),kind:null,dx:0,dy:0};
  });
  surface.addEventListener('pointermove', event => {
   if (!gesture || event.pointerId !== gesture.id) return;
   const g=gesture;g.dx=event.clientX-g.x;g.dy=event.clientY-g.y;
   if (g.card && now()-g.started >= 450 && !g.kind) {gesture=null;return;}
   if (!g.kind) {
    if (Math.hypot(g.dx,g.dy)<12) return;
    if (Math.abs(g.dy)>=Math.abs(g.dx)) {gesture=null;return;}
    const outward=(g.left<=2 && g.dx>0)||(g.left>=g.max-2 && g.dx<0);
    g.kind=g.max>2 && !outward?'scroll':'navigate';
    try {surface.setPointerCapture(event.pointerId);} catch (_) {}
   }
   if (g.kind==='scroll') surface.scrollLeft=Math.max(0,Math.min(g.max,g.left-g.dx));
   if (event.cancelable) event.preventDefault();
   suppressClickUntil=now()+700;
  });
  surface.addEventListener('pointerup', event => {
   if (!gesture || event.pointerId!==gesture.id) return;
   const g=gesture;gesture=null;release(event);
   if (!g.kind) return;
   suppressClickUntil=now()+700;
   const dx=event.clientX-g.x,dy=event.clientY-g.y;
   const threshold=Math.min(90,Math.max(48,surface.clientWidth*.16));
   if (g.kind==='navigate' && Math.abs(dx)>=threshold && Math.abs(dx)>Math.abs(dy)*1.35 && now()-g.started<2500) {
    if (event.cancelable) event.preventDefault();
    onNavigate(dx<0?1:-1);
   }
  });
  surface.addEventListener('pointercancel', event => {gesture=null;release(event);});
  surface.addEventListener('lostpointercapture', event => {if(event.target===surface)gesture=null;});
 }
 global.SalonGestures={attach};
})(window);

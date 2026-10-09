(function(){
  var track=document.getElementById('track');
  var pages=[].slice.call(track.children);
  var referral=document.getElementById('referral-invite');
  if(referral){
    referral.classList.add('page','referral-page');
    document.querySelectorAll('[data-go]').forEach(function(b){b.dataset.go=String(Number(b.dataset.go)+1)});
    var inviteStep=document.createElement('button');inviteStep.className='step';inviteStep.dataset.go='0';inviteStep.textContent='초대장';
    document.getElementById('steps').prepend(inviteStep);
    document.getElementById('steps').style.gridTemplateColumns='repeat(5,1fr)';
  }
  var steps=[].slice.call(document.querySelectorAll('.step'));
  var ids=pages.map(function(p){return p.id});
  var cur=-1,lock=false;
  var stage=track.parentNode;
  // 주소의 #앵커로 브라우저가 무대를 직접 스크롤하지 않도록 고정
  stage.addEventListener('scroll',function(){stage.scrollLeft=0;stage.scrollTop=0});

  function go(i,fromHash){
    i=Math.max(0,Math.min(pages.length-1,i));
    if(i===cur)return;
    cur=i;stage.scrollLeft=0;
    document.getElementById('app').classList.toggle('dark',pages[i].id==='home');
    track.style.transform='translateX('+(-100*i)+'%)';
    pages.forEach(function(p,k){p.inert=k!==i;p.setAttribute('aria-hidden',k!==i);if(k===i)p.scrollTop=0});
    steps.forEach(function(s,k){s.setAttribute('aria-current',k===i);s.classList.toggle('done',k<i)});
    if(!fromHash){try{history.replaceState(null,'','#'+ids[i])}catch(e){}}
  }

  // 상세 뷰어: SET·DO·REVIEW를 한 dialog 안의 슬라이드로 넘기고, 위쪽 순서 표시에 현재 단계를 표시
  var viewer=document.getElementById('detail');
  var vTrack=document.getElementById('viewer-track'),vStage=vTrack.parentNode;
  var slides=[].slice.call(vTrack.children);
  var flow=[].slice.call(viewer.querySelectorAll('[data-slide]'));
  var order=['set','do','review'],slide=0,opener=null;
  function show(i,focus){
    slide=Math.max(0,Math.min(slides.length-1,i));
    vStage.scrollTop=0;
    slides.forEach(function(s,k){s.style.transform='translateX('+(100*(k-slide))+'%)';s.inert=k!==slide;s.setAttribute('aria-hidden',k!==slide)});
    flow.forEach(function(b,k){
      if(k===slide)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');
      b.parentNode.classList.toggle('done',k<slide);
    });
    if(focus)flow[slide].focus();
  }
  viewer.addEventListener('close',function(){if(opener)opener.focus()});
  viewer.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'){e.preventDefault();show(slide+1,true)}
    else if(e.key==='ArrowLeft'){e.preventDefault();show(slide-1,true)}
  });
  var vx=0,vy=0;
  vTrack.addEventListener('touchstart',function(e){vx=e.touches[0].clientX;vy=e.touches[0].clientY},{passive:true});
  vTrack.addEventListener('touchend',function(e){
    var dx=e.changedTouches[0].clientX-vx,dy=e.changedTouches[0].clientY-vy;
    if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.3)show(slide+(dx<0?1:-1));
  },{passive:true});

  document.addEventListener('click',function(e){
    var detail=e.target.closest('[data-detail]');
    if(detail){
      opener=detail;
      viewer.classList.add('instant');
      show(order.indexOf(detail.dataset.detail));
      viewer.showModal();flow[slide].focus();
      requestAnimationFrame(function(){requestAnimationFrame(function(){viewer.classList.remove('instant')})});
      return;
    }
    var sl=e.target.closest('[data-slide]');
    if(sl){show(+sl.dataset.slide);return;}
    var t=e.target.closest('[data-go]');
    if(t){e.preventDefault();go(+t.dataset.go)}
  });

  document.addEventListener('keydown',function(e){
    if(document.querySelector('dialog[open]'))return;
    if(e.target.closest('button,a,input,textarea,select,[contenteditable]'))return;
    if(['ArrowRight','ArrowDown','PageDown',' '].indexOf(e.key)>-1){e.preventDefault();go(cur+1)}
    else if(['ArrowLeft','ArrowUp','PageUp'].indexOf(e.key)>-1){e.preventDefault();go(cur-1)}
    else if(e.key==='Home'){go(0)}else if(e.key==='End'){go(pages.length-1)}
  });

  // 휠: 페이지 안에 스크롤할 내용이 남아 있으면 그 스크롤을 우선
  window.addEventListener('wheel',function(e){
    if(document.querySelector('dialog[open]'))return;
    var p=pages[cur],d=Math.abs(e.deltaY)>Math.abs(e.deltaX)?e.deltaY:e.deltaX;
    if(Math.abs(d)<12||lock)return;
    var canDown=p.scrollTop+p.clientHeight<p.scrollHeight-2,canUp=p.scrollTop>0;
    if((d>0&&canDown)||(d<0&&canUp))return;
    lock=true;setTimeout(function(){lock=false},800);
    go(cur+(d>0?1:-1));
  },{passive:true});

  // 스와이프 (가로)
  var sx=0,sy=0;
  track.addEventListener('touchstart',function(e){sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
  track.addEventListener('touchend',function(e){
    var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
    if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.3)go(cur+(dx<0?1:-1));
  },{passive:true});

  window.addEventListener('hashchange',function(){var k=ids.indexOf(location.hash.slice(1));if(k>-1)go(k,true)});
  document.documentElement.classList.add('landing-ready');
  var start=ids.indexOf(location.hash.slice(1));
  track.style.transition='none';go(start>-1?start:0,true);
  requestAnimationFrame(function(){requestAnimationFrame(function(){track.style.transition=''})});
})();

const copyButton = document.querySelector("[data-copy]");
const copyStatus = document.querySelector("#copy-status");
if (copyButton instanceof HTMLButtonElement && copyStatus instanceof HTMLElement) {
  copyButton.addEventListener("click", async () => {
    const text = document.querySelector("#share-copy")?.textContent?.trim() ?? "";
    try { await navigator.clipboard.writeText(text); copyStatus.textContent = "복사했습니다."; }
    catch { const fallback = document.createElement("textarea"); fallback.value = text; fallback.readOnly = true; fallback.className = "copy-fallback"; document.body.append(fallback); fallback.select(); const copied = document.execCommand("copy"); fallback.remove(); copyStatus.textContent = copied ? "복사했습니다." : "복사할 수 없어요. 문구를 직접 선택해 주세요."; }
  });
}
const applicationForm = document.querySelector("[data-application-form]");
if (applicationForm instanceof HTMLFormElement) {
  applicationForm.addEventListener("submit", () => {
    const submit = applicationForm.querySelector("[data-submit]");
    const status = applicationForm.querySelector("[data-form-status]");
    if (submit instanceof HTMLButtonElement) submit.disabled = true;
    if (status instanceof HTMLElement) status.textContent = "확인했습니다. Slack을 열고 있어요.";
  });
}

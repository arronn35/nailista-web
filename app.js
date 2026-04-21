// ========== Cursor-reactive 3D scene ==========
(function(){
  const scene = document.querySelector('#heroScene');
  const stage = scene?.querySelector('.scene-stage');
  if(!scene || !stage) return;

  let targetX = 0, targetY = 0, curX = 0, curY = 0;
  let raf = null;

  function onMove(e){
    const r = scene.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;   // 0..1
    const py = (e.clientY - r.top)  / r.height;  // 0..1
    targetX = (px - 0.5) * 2;   // -1..1
    targetY = (py - 0.5) * 2;
    if(!raf) raf = requestAnimationFrame(tick);
  }
  function tick(){
    curX += (targetX - curX) * 0.08;
    curY += (targetY - curY) * 0.08;
    stage.style.transform = `rotateX(${(-curY * 6).toFixed(2)}deg) rotateY(${(curX * 8).toFixed(2)}deg)`;
    // parallax polish bottles
    stage.querySelectorAll('.polish').forEach((el, i)=>{
      const depth = (i+1) * 4;
      el.style.setProperty('--px', `${(curX * depth).toFixed(1)}px`);
      el.style.setProperty('--py', `${(curY * depth).toFixed(1)}px`);
    });
    if(Math.abs(targetX - curX) > 0.001 || Math.abs(targetY - curY) > 0.001){
      raf = requestAnimationFrame(tick);
    } else {
      raf = null;
    }
  }
  window.addEventListener('mousemove', onMove, {passive: true});
  window.addEventListener('mouseleave', ()=>{ targetX = 0; targetY = 0; if(!raf) raf = requestAnimationFrame(tick) });
})();

// ========== Waitlist forms ==========
(function(){
  const WAITLIST_ENDPOINTS = resolveWaitlistEndpoints();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  const sourceByFormId = {
    heroForm: 'hero',
    mainForm: 'main',
    footerForm: 'footer',
  };

  const forms = document.querySelectorAll('.waitlist-form');
  const success = document.getElementById('waitSuccess');
  const mainForm = document.getElementById('mainForm');
  const mainSuccessTitle = success?.querySelector('h3');
  const mainSuccessBody = success?.querySelector('p');
  const utm = readUtmParams();

  forms.forEach(form => {
    const input = form.querySelector('input[type="email"]');
    const button = form.querySelector('button');
    const buttonTextNode = form.querySelector('button .btn-text') || button;
    const defaultButtonText = buttonTextNode?.textContent || '';

    if(!input || !button || !buttonTextNode) return;

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = (input?.value || '').trim();
      if(!email || !emailRegex.test(email)){
        showInlineMessage(buttonTextNode, defaultButtonText, 'Enter a valid email.');
        return;
      }

      setSubmittingState(button, buttonTextNode, true);

      const result = await submitWaitlist({
        email,
        sourceForm: sourceByFormId[form.id] || 'hero',
        utm,
        referrer: document.referrer || undefined,
      });

      setSubmittingState(button, buttonTextNode, false, defaultButtonText);

      if(!result.success){
        showInlineMessage(buttonTextNode, defaultButtonText, result.message || 'Try again in a moment.');
        return;
      }

      if(result.status === 'created'){
        burstConfetti(form);
      }

      if(form === mainForm){
        form.style.display = 'none';
        if(success){
          if(result.status === 'already_exists'){
            if(mainSuccessTitle) mainSuccessTitle.textContent = 'Already on the list.';
            if(mainSuccessBody) mainSuccessBody.textContent = 'This email is already registered. We will notify you at launch.';
          } else {
            if(mainSuccessTitle) mainSuccessTitle.textContent = "You're in!";
            if(mainSuccessBody) mainSuccessBody.textContent = 'We will email you when Nailista opens. Until then, stay gorgeous.';
          }
          success.classList.add('show');
        }
      } else {
        input.value = '';
        if(result.status === 'already_exists'){
          showInlineMessage(buttonTextNode, defaultButtonText, 'Already on waitlist ✓');
        } else {
          showInlineMessage(buttonTextNode, defaultButtonText, "You're in! ✓");
        }
      }
    });
  });

  function setSubmittingState(button, textNode, isSubmitting, fallbackText){
    button.disabled = isSubmitting;
    if(isSubmitting){
      textNode.textContent = 'Submitting...';
      return;
    }
    if(fallbackText){
      textNode.textContent = fallbackText;
    }
  }

  function showInlineMessage(textNode, originalText, message){
    textNode.textContent = message;
    setTimeout(()=>{ textNode.textContent = originalText; }, 2600);
  }

  async function submitWaitlist(payload){
    let lastFailure = null;

    for(const endpoint of WAITLIST_ENDPOINTS){
      const result = await submitToEndpoint(endpoint, payload);
      if(result.success){
        return result;
      }

      lastFailure = result;
      const retryable = result.status === 'network' || result.status === 'not_found' || result.status === 'server_error';
      if(!retryable){
        return result;
      }
    }

    return lastFailure || {
      success: false,
      status: 'invalid',
      message: 'Could not submit. Please try again.',
    };
  }

  async function submitToEndpoint(endpoint, payload){
    try{
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if(response.ok){
        return {
          success: true,
          status: data.status || 'created',
          message: data.message || 'You are on the waitlist.',
        };
      }

      if(response.status === 429){
        return {
          success: false,
          status: 'rate_limited',
          message: data.message || 'Too many requests, wait a minute and try again.',
        };
      }

      if(response.status === 404 || response.status === 405){
        return {
          success: false,
          status: 'not_found',
          message: 'Waitlist endpoint unavailable.',
        };
      }

      if(response.status >= 500){
        return {
          success: false,
          status: 'server_error',
          message: data.message || 'Temporary server error. Please try again.',
        };
      }

      return {
        success: false,
        status: data.status || 'invalid',
        message: data.message || 'Could not submit. Please try again.',
      };
    } catch(_error){
      return {
        success: false,
        status: 'network',
        message: 'Network error. Please try again.',
      };
    }
  }

  function resolveWaitlistEndpoints(){
    const candidates = [
      window.NAILISTA_WAITLIST_ENDPOINT,
      '/api/submitWaitlist',
      'https://europe-west1-nailista-web.cloudfunctions.net/submitWaitlist',
      'https://submitwaitlist-zu7lpbl3ra-ew.a.run.app',
    ];

    const deduped = [];
    candidates.forEach((item) => {
      if(typeof item !== 'string') return;
      const endpoint = item.trim();
      if(!endpoint) return;
      if(deduped.includes(endpoint)) return;
      deduped.push(endpoint);
    });

    return deduped;
  }

  function readUtmParams(){
    const keys = ['source', 'medium', 'campaign', 'term', 'content'];
    const params = new URLSearchParams(window.location.search);
    const payload = {};

    keys.forEach(key => {
      const value = params.get(`utm_${key}`);
      if(value){
        payload[key] = value;
      }
    });

    return Object.keys(payload).length ? payload : undefined;
  }
})();

// ========== Confetti ==========
function burstConfetti(origin){
  const rect = origin.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  const colors = ['#FF8AA0', '#C8A2E8', '#7FD9B8', '#FFC96B', '#A5D4F0', '#C89878'];
  const n = 28;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:9999;pointer-events:none';
  document.body.appendChild(container);

  for(let i=0;i<n;i++){
    const p = document.createElement('div');
    const size = 6 + Math.random()*8;
    const ang = Math.random() * Math.PI * 2;
    const vel = 90 + Math.random()*160;
    const dx = Math.cos(ang) * vel;
    const dy = Math.sin(ang) * vel - 40;
    const rot = (Math.random() * 540 - 270);
    p.style.cssText = `
      position:absolute; left:${cx}px; top:${cy}px;
      width:${size}px; height:${size*1.6}px;
      background:${colors[i%colors.length]};
      border-radius:2px;
      transform: translate(-50%,-50%);
      transition: transform 1.1s cubic-bezier(.2,.7,.3,1), opacity 1.1s;
      opacity:1;
    `;
    container.appendChild(p);
    requestAnimationFrame(()=>{
      p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 160}px)) rotate(${rot}deg)`;
      p.style.opacity = '0';
    });
  }
  setTimeout(()=>container.remove(), 1400);
}

// ========== Scroll reveals ==========
(function(){
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        e.target.classList.add('revealed');
        io.unobserve(e.target);
      }
    });
  }, {threshold: 0.12});
  document.querySelectorAll('.feature, .step, .split-card, .wait-card, .faq details').forEach(el=>{
    el.classList.add('reveal');
    io.observe(el);
  });
})();

// ========== Anchor link guard ==========
(function(){
  const nav = document.querySelector('.nav');

  function navOffset(){
    return (nav?.offsetHeight || 0) + 12;
  }

  function findTarget(hash){
    if(!hash || hash === '#') return null;
    try{
      return document.querySelector(decodeURIComponent(hash));
    } catch(_error){
      return null;
    }
  }

  function scrollToHash(hash, behavior = 'smooth'){
    const target = findTarget(hash);
    if(!target) return false;
    const top = window.scrollY + target.getBoundingClientRect().top - navOffset();
    window.scrollTo({ top: Math.max(0, top), behavior });
    return true;
  }

  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', event => {
      const hash = link.getAttribute('href');
      if(!hash || hash === '#') return;

      event.preventDefault();
      const ok = scrollToHash(hash);
      if(ok){
        history.pushState(null, '', hash);
      } else {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  if(window.location.hash){
    window.addEventListener('load', () => {
      const ok = scrollToHash(window.location.hash, 'auto');
      if(!ok){
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }, { once: true });
  }

  window.addEventListener('hashchange', () => {
    if(!window.location.hash) return;
    const ok = scrollToHash(window.location.hash, 'auto');
    if(!ok){
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  });
})();

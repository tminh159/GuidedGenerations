var Ye={xPct:94,yPct:22};function fe(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function le(e,t,n){if(!Number.isFinite(e))return t;if(t>n)return(t+n)/2;return Math.max(t,Math.min(n,e))}function Ce(e,t=2,n=98){return le(e,t,n)}function Et(e){return Boolean(e)&&(typeof e==="object"||typeof e==="function")&&typeof e.then==="function"}function xt(e){if(!fe(e))return null;if(typeof e.chatId==="string"&&e.chatId)return e.chatId;if(typeof e.id==="string"&&e.id)return e.id;if(fe(e.chat)&&typeof e.chat.id==="string"&&e.chat.id)return e.chat.id;return null}function Ze(e){let t=e.trim();if(!t)return"GG";let n=t.split(/[\s_-]+/).filter(Boolean);if(n.length>=2)return`${n[0][0]??""}${n[1][0]??""}`.toUpperCase();return t.slice(0,2).toUpperCase()}function Pe(e){return`/api/v1/characters/${encodeURIComponent(e)}/avatar?thumb=1`}function ue(e){if(typeof e!=="string")return;let t=e.trim();if(!t)return;if(t.startsWith("/")&&!t.startsWith("//"))return t;if(/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(t))return t;try{let n=new URL(t);if(n.protocol==="http:"||n.protocol==="https:")return t}catch{}return}function Ct(e,t,n=0){return!(e.right+n<=t.left||e.left>=t.right+n||e.bottom+n<=t.top||e.top>=t.bottom+n)}class _e{ctx;heads=new Map;headItemEls=new Map;characterCache=new Map;pendingCharacterFetches=new Set;disposers=[];rootEl=null;resizeCleanup=null;dragCleanup=null;suppressClickTimer=null;suppressNextClick=!1;isDragging=!1;pos;destroyed=!1;constructor(e){this.ctx=e;if(this.pos=this.loadPosition(),typeof this.ctx.events?.on==="function")try{this.disposers.push(this.ctx.events.on("CHAT_DELETED",(t)=>{this.onChatDeleted(xt(t))}))}catch{}}syncRuns(e,t){if(this.destroyed)return;let n=t!==void 0?t:this.safeGetActiveChatId();if(n){if(this.heads.get(n)?.status==="completed")this.heads.delete(n)}let i=new Map;for(let r of e){let s=r;if(s&&typeof s.chatId==="string"&&s.chatId.length>0)i.set(s.chatId,s)}for(let[r,s]of[...this.heads.entries()]){if(s.status==="completed")continue;if(!i.has(r))this.heads.delete(r)}for(let[,r]of i.entries())this.upsertFromActiveRun(r,n);this.render(n)}handleStatusEvent(e,t){if(this.destroyed)return;let n=t!==void 0?t:this.safeGetActiveChatId(),i=typeof e.chatId==="string"&&e.chatId.length>0?e.chatId:void 0,r=e.run??null,s=Boolean(e.done)||Boolean(e.aborted)||Boolean(e.error);if(i&&(s||!r||r.chatId!==i))this.finalizeChatRun(i,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n);if(r&&typeof r.chatId==="string"&&r.chatId.length>0){if(!s||i!==void 0&&r.chatId!==i)this.upsertFromActiveRun(r,n);else if(!i&&s)this.finalizeChatRun(r.chatId,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n)}else if(!i){for(let[l,d]of[...this.heads.entries()])if(d.status==="running"||d.status==="streaming")this.finalizeChatRun(l,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n)}this.render(n)}onChatChanged(e){if(this.destroyed)return;let t=e!==void 0?e:this.safeGetActiveChatId();if(t){if(this.heads.get(t)?.status==="completed")this.heads.delete(t)}this.render(t)}onChatDeleted(e){if(this.destroyed||!e)return;if(this.heads.delete(e))this.render()}destroy(){if(this.destroyed)return;this.destroyed=!0,this.clearDragSession(),this.clearResizeListener(),this.clearSuppressClickTimer(),this.suppressNextClick=!1;for(let e of this.disposers)try{e()}catch{}if(this.disposers.length=0,this.heads.clear(),this.headItemEls.clear(),this.pendingCharacterFetches.clear(),this.rootEl)this.rootEl.remove(),this.rootEl=null}upsertFromActiveRun(e,t){let n=this.heads.get(e.chatId),i=t===e.chatId?this.safeGetActiveChat():null,r=(typeof e.characterId==="string"&&e.characterId.length>0?e.characterId:void 0)??n?.characterId??(typeof i?.characterId==="string"&&i.characterId.length>0?i.characterId:void 0),s=r?this.characterCache.get(r):void 0,l=(typeof e.characterName==="string"&&e.characterName.trim().length>0?e.characterName.trim():void 0)??n?.characterName??s?.name,d=ue(e.avatarUrl)??ue(n?.avatarUrl)??ue(s?.avatarUrl)??(r?Pe(r):void 0),o=e.hasContentOutput?"streaming":"running",p={chatId:e.chatId,runId:e.runId,status:o,startedAt:e.startedAt,...r?{characterId:r}:{},...l?{characterName:l}:{},...d?{avatarUrl:d}:{},...n?.avatarFailed&&n.avatarUrl===d?{avatarFailed:!0}:{}};if(this.heads.set(e.chatId,p),r&&!l&&!this.characterCache.has(r))this.resolveCharacterMeta(e.chatId,r)}finalizeChatRun(e,t,n){let i=this.heads.get(e);if(t.aborted||t.hasError||n===e){this.heads.delete(e);return}if(i)this.heads.set(e,{...i,status:"completed"});else this.heads.set(e,{chatId:e,runId:`gg-completed-${e}`,status:"completed",startedAt:Date.now()})}async resolveCharacterMeta(e,t){if(this.destroyed||!t)return;if(this.pendingCharacterFetches.has(t)||this.characterCache.has(t))return;let n=this.ctx.characters;if(typeof n?.get!=="function")return;this.pendingCharacterFetches.add(t);try{let i=await Promise.resolve(n.get(t));if(this.destroyed)return;if(!fe(i)){this.characterCache.set(t,{});return}let r=typeof i.name==="string"&&i.name.trim().length>0?i.name.trim():void 0,s=Pe(t),l=ue(i.avatarUrl)??ue(i.avatar_url),d=l??s;this.characterCache.set(t,{...r?{name:r}:{},avatarUrl:d});let o=this.heads.get(e);if(o&&o.characterId===t){let p=!1;if(r&&!o.characterName)o.characterName=r,p=!0;if(l&&(!o.avatarUrl||o.avatarUrl===s)){if(o.avatarUrl!==l)o.avatarUrl=l,delete o.avatarFailed,p=!0}else if(d&&!o.avatarUrl)o.avatarUrl=d,p=!0;if(p)this.render()}}catch{if(!this.destroyed)this.characterCache.set(t,{})}finally{this.pendingCharacterFetches.delete(t)}}render(e){if(this.destroyed)return;if(typeof document>"u"||!document.body)return;let t=e!==void 0?e:this.safeGetActiveChatId(),n=[];for(let l of this.heads.values()){if(l.chatId===t)continue;if(this.hasNativeChatHead(l.chatId))continue;n.push(l)}if(n.length===0){if(this.clearDragSession(),this.clearResizeListener(),this.headItemEls.clear(),this.rootEl)this.rootEl.remove(),this.rootEl=null;return}let i=!this.isDragging,r=i?(()=>{let l=this.findNativeChatHeadsContainer();if(!l)return null;let{vw:d,vh:o}=this.getViewportSize();return this.resolveNativeBounds(l,d,o)})():null;if(!this.rootEl)this.rootEl=document.createElement("div"),this.rootEl.className="gg-chat-heads-root",this.rootEl.setAttribute("data-gg-chat-heads-root","true"),this.attachDragHandlers(this.rootEl),this.ensureResizeListener();let s=new Set(n.map((l)=>l.chatId));for(let[l,d]of[...this.headItemEls.entries()])if(!s.has(l))d.remove(),this.headItemEls.delete(l);for(let l=0;l<n.length;l+=1){let d=n[l],o=this.headItemEls.get(d.chatId);if(o)this.updateHeadItem(o,d);else o=this.buildHeadItem(d),this.headItemEls.set(d.chatId,o);if(this.rootEl.children[l]!==o)this.rootEl.insertBefore(o,this.rootEl.children[l]??null)}if(this.applyRootPosition(this.rootEl,n.length,{avoidNative:i,nativeBox:r}),!this.rootEl.isConnected)document.body.append(this.rootEl)}buildHeadItem(e){let t=e.chatId,n=document.createElement("div");n.className="gg-chat-head-item";let i=document.createElement("button");i.type="button",i.className="gg-chat-head",i.setAttribute("data-gg-chat-head","true"),i.setAttribute("data-chat-id",t);let r=document.createElement("span");return r.className="gg-chat-head-badge",r.setAttribute("aria-hidden","true"),i.append(r),i.addEventListener("contextmenu",(s)=>{if(s.preventDefault(),s.stopPropagation(),!this.isDragging&&this.heads.get(t)?.status==="completed")this.dismissCompletedHead(t)}),i.addEventListener("click",(s)=>{if(s.preventDefault(),s.stopPropagation(),this.suppressNextClick){this.suppressNextClick=!1,this.clearSuppressClickTimer();return}this.navigateToChat(t,()=>{if(this.destroyed)return;if(this.heads.get(t)?.status==="completed")this.heads.delete(t),this.render()})}),n.append(i),this.updateHeadItem(n,e),n}updateHeadItem(e,t){let n=e.querySelector("[data-gg-chat-head]"),i=n?.querySelector(".gg-chat-head-badge");if(!n||!i)return;n.classList.toggle("is-running",t.status==="running"||t.status==="streaming"),n.classList.toggle("is-streaming",t.status==="streaming"),n.classList.toggle("is-completed",t.status==="completed"),n.setAttribute("data-status",t.status);let r=t.characterName||t.chatId,s=t.status==="completed"?"Generation completed — click to open chat":t.status==="streaming"?"Streaming response in background — click to open chat":"Generating response in background — click to open chat",l=`${r}: ${s}`;n.setAttribute("aria-label",l),n.title=l;let d=ue(t.avatarUrl)??(t.characterId?Pe(t.characterId):void 0),o=n.querySelector(".gg-chat-head-avatar"),p=n.querySelector(".gg-chat-head-initials");if(d&&!t.avatarFailed)if(p?.remove(),o){if(o.getAttribute("src")!==d)o.src=d;o.alt=r}else{let a=document.createElement("img");a.className="gg-chat-head-avatar",a.src=d,a.alt=r,a.draggable=!1,a.addEventListener("error",()=>{if(this.destroyed)return;let m=this.heads.get(t.chatId);if(m)m.avatarFailed=!0;if(a.isConnected){let x=this.heads.get(t.chatId)?.characterName||t.chatId,u=document.createElement("span");u.className="gg-chat-head-initials",u.textContent=Ze(x),a.replaceWith(u)}}),n.insertBefore(a,i)}else{o?.remove();let a=Ze(r);if(p)p.textContent=a;else{let m=document.createElement("span");m.className="gg-chat-head-initials",m.textContent=a,n.insertBefore(m,i)}}let h=n.querySelector(".gg-chat-head-pip");if(t.status==="completed"){if(!h){let a=document.createElement("span");a.className="gg-chat-head-pip",a.setAttribute("aria-hidden","true"),n.append(a)}}else h?.remove();let g=e.querySelector("[data-gg-chat-head-dismiss]");if(t.status==="completed")if(g)g.setAttribute("aria-label",`Dismiss ${r}`);else{let a=document.createElement("button");a.type="button",a.className="gg-chat-head-dismiss",a.setAttribute("data-gg-chat-head-dismiss","true"),a.setAttribute("aria-label",`Dismiss ${r}`),a.title="Dismiss",a.textContent="×",a.addEventListener("click",(m)=>{m.preventDefault(),m.stopPropagation(),this.dismissCompletedHead(t.chatId)}),e.append(a)}else g?.remove()}dismissCompletedHead(e){if(this.destroyed)return;if(this.heads.get(e)?.status==="completed")this.heads.delete(e),this.render()}isNativeChatHeadElement(e){if(e.hasAttribute("data-gg-chat-head"))return!1;if(e.closest("[data-gg-chat-heads-root]"))return!1;if(e.hasAttribute("data-head-idx"))return!0;if(e.hasAttribute("data-chat-head"))return!0;let t=e.parentElement;if(t&&t.parentElement===document.body){let n=typeof t.className==="string"?t.className:"";if(t.querySelector("[data-head-idx]")!==null||/ChatHeads/i.test(n))return!0}return!1}hasNativeChatHead(e){if(typeof document>"u"||!document.body||!e)return!1;let t=document.body.querySelectorAll("[data-head-idx][data-chat-id]:not([data-gg-chat-head]), [data-chat-head][data-chat-id]:not([data-gg-chat-head]), body > * > [data-chat-id]:not([data-gg-chat-head])");for(let n of t)if(n.getAttribute("data-chat-id")===e&&this.isNativeChatHeadElement(n))return!0;return!1}findNativeChatHeadsContainer(){if(typeof document>"u"||!document.body)return null;let e=document.body.querySelector("[data-head-idx][data-chat-id]:not([data-gg-chat-head]), [data-chat-head][data-chat-id]:not([data-gg-chat-head])");if(!e||e.closest("[data-gg-chat-heads-root]"))return null;let t=e.parentElement;if(!t||t===document.body)return e;return t}getViewportSize(){let e=typeof window<"u"?window:typeof document<"u"?document.defaultView:null,t=e&&typeof e.innerWidth==="number"&&e.innerWidth>0?e.innerWidth:(typeof document<"u"?document.documentElement?.clientWidth:0)||1024,n=e&&typeof e.innerHeight==="number"&&e.innerHeight>0?e.innerHeight:(typeof document<"u"?document.documentElement?.clientHeight:0)||768;return{vw:t,vh:n}}getStackDimensions(e,t){let n=Math.max(1,e),i=60,r=n*48+Math.max(0,n-1)*10+12,s=Math.max(60,t-24);return{width:60,height:Math.min(r,s)}}clampCenterPos(e,t){let{vw:n,vh:i}=this.getViewportSize(),{width:r,height:s}=this.getStackDimensions(t,i),l=12+r/2,d=n-12-r/2,o=12+s/2,p=i-12-s/2,h=le(e.xPct/100*n,l,d),g=le(e.yPct/100*i,o,p);return{xPct:h/n*100,yPct:g/i*100}}resolveNativeBounds(e,t,n){try{let m=e.getBoundingClientRect?.();if(m&&m.width>0&&m.height>0)return{left:m.left,top:m.top,right:m.right,bottom:m.bottom}}catch{}let i=e.querySelectorAll("[data-head-idx], [data-chat-head]"),r=Math.max(1,i.length),s=e.style?.flexDirection==="row",l=s?r*48+Math.max(0,r-1)*8+12:60,d=s?60:r*48+Math.max(0,r-1)*8+12,o=parseFloat(e.style?.left??""),p=parseFloat(e.style?.top??"");if(Number.isFinite(o)&&Number.isFinite(p)&&o>=0&&p>=0)return{left:o,top:p,right:o+l,bottom:p+d};let h=this.readNativeStoredPosition();if(h){let m,x;if(h.xPct<0||h.yPct<0)m=t-l-12,x=Math.round((n-d)/2);else if(h.xPct<=1&&h.yPct<=1)m=le(h.xPct*t,12,t-l-12),x=le(h.yPct*n,12,n-d-12);else m=le(h.xPct/100*t,12,t-l-12),x=le(h.yPct/100*n,12,n-d-12);return{left:m,top:x,right:m+l,bottom:x+d}}let g=t-l-12,a=Math.round((n-d)/2);return{left:g,top:a,right:g+l,bottom:a+d}}readNativeStoredPosition(){try{let t=this.getStorage()?.getItem("lumiverse:chatHeadsPos");if(!t)return null;let n=JSON.parse(t);if(fe(n)&&typeof n.xPct==="number"&&Number.isFinite(n.xPct)&&typeof n.yPct==="number"&&Number.isFinite(n.yPct))return{xPct:n.xPct,yPct:n.yPct}}catch{}return null}attachDragHandlers(e){e.addEventListener("click",()=>{if(this.suppressNextClick)this.suppressNextClick=!1,this.clearSuppressClickTimer()}),e.addEventListener("pointerdown",(t)=>{if(this.destroyed)return;if(t.pointerType==="mouse"&&t.button!==0)return;if(typeof document>"u")return;let n=t.target;if(n?.closest?.("[data-gg-chat-head-dismiss]"))return;if(this.isDragging)return;this.clearSuppressClickTimer(),this.suppressNextClick=!1,this.clearDragSession();let{pointerId:i,clientX:r,clientY:s}=t,l=this.rootEl?.children.length||this.heads.size||1,d=parseFloat(e.style.left),o=parseFloat(e.style.top),p=Number.isFinite(d)&&Number.isFinite(o)?{xPct:d,yPct:o}:this.clampCenterPos(this.pos,l),h=!1,g=!1,a=null,m=()=>{if(a!==null)clearTimeout(a),a=null},x=(L)=>{if(L.pointerId!==i)return;let y=L.clientX-r,C=L.clientY-s;if(!h&&Math.hypot(y,C)>6){h=!0,m(),this.isDragging=!0,this.suppressNextClick=!0,e.classList.add("is-dragging");try{e.setPointerCapture?.(i)}catch{}}if(!h)return;let{vw:I,vh:S}=this.getViewportSize(),P=this.rootEl?.children.length||this.heads.size||1;if(this.pos=this.clampCenterPos({xPct:p.xPct+y/I*100,yPct:p.yPct+C/S*100},P),this.rootEl)this.applyRootPosition(this.rootEl,P,{avoidNative:!1})},u=()=>{if(g)return;g=!0,m(),this.clearDragSession(),e.classList.remove("is-dragging");try{if(e.hasPointerCapture?.(i))e.releasePointerCapture?.(i)}catch{}if(h){if(this.savePosition(this.pos),this.rootEl){let L=this.rootEl.children.length||this.heads.size||1;this.applyRootPosition(this.rootEl,L)}this.clearSuppressClickTimer(),this.suppressClickTimer=setTimeout(()=>{this.suppressClickTimer=null,this.suppressNextClick=!1},350)}},R=n?.closest?.("[data-gg-chat-head]")?.getAttribute("data-chat-id")??null;if(t.pointerType==="touch"&&R&&this.heads.get(R)?.status==="completed")a=setTimeout(()=>{if(a=null,h||g||this.destroyed)return;if(this.heads.get(R)?.status!=="completed")return;this.suppressNextClick=!0,this.clearSuppressClickTimer(),this.suppressClickTimer=setTimeout(()=>{this.suppressClickTimer=null,this.suppressNextClick=!1},350),u(),this.dismissCompletedHead(R)},450);let E=(L)=>{if(L.pointerId!==i)return;u()},b=(L)=>{if(L.pointerId!==i)return;if(L.target!==e)return;u()},_=()=>{u()},N=(L)=>{if(h&&L.cancelable)L.preventDefault()},k=typeof window<"u"?window:document.defaultView;if(document.addEventListener("pointermove",x,!0),document.addEventListener("pointerup",E,!0),document.addEventListener("pointercancel",E,!0),t.pointerType==="touch")document.addEventListener("touchmove",N,{capture:!0,passive:!1});e.addEventListener("lostpointercapture",b),k?.addEventListener("blur",_),this.dragCleanup=()=>{if(m(),document.removeEventListener("pointermove",x,!0),document.removeEventListener("pointerup",E,!0),document.removeEventListener("pointercancel",E,!0),t.pointerType==="touch")document.removeEventListener("touchmove",N,!0);e.removeEventListener("lostpointercapture",b),k?.removeEventListener("blur",_)}})}clearDragSession(){if(this.isDragging=!1,this.rootEl?.classList.remove("is-dragging"),this.dragCleanup){let e=this.dragCleanup;this.dragCleanup=null,e()}}clearSuppressClickTimer(){if(this.suppressClickTimer!==null)clearTimeout(this.suppressClickTimer),this.suppressClickTimer=null}ensureResizeListener(){if(this.resizeCleanup)return;let e=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(!e)return;let t=()=>{if(this.destroyed||!this.rootEl)return;let n=this.rootEl.children.length||this.heads.size||1;this.applyRootPosition(this.rootEl,n,{avoidNative:!this.isDragging})};e.addEventListener("resize",t),this.resizeCleanup=()=>{e.removeEventListener("resize",t)}}clearResizeListener(){if(this.resizeCleanup){let e=this.resizeCleanup;this.resizeCleanup=null,e()}}applyRootPosition(e,t=this.heads.size||1,n={}){let{vw:i,vh:r}=this.getViewportSize(),{width:s,height:l}=this.getStackDimensions(t,r),d=this.clampCenterPos(this.pos,t),o=d.xPct/100*i,p=d.yPct/100*r;if(n.avoidNative!==!1){let a=n.nativeBox!==void 0?n.nativeBox:(()=>{let m=this.findNativeChatHeadsContainer();return m?this.resolveNativeBounds(m,i,r):null})();if(a){let m=12+s/2,x=i-12-s/2,u=12+l/2,T=r-12-l/2,R={left:o-s/2,top:p-l/2,right:o+s/2,bottom:p+l/2};if(Ct(R,a,8)){let E=a.bottom+8+l/2,b=a.top-8-l/2,_=a.left-8-s/2,N=a.right+8+s/2;if(E>=u&&E<=T)p=E;else if(b>=u&&b<=T)p=b;else if(_>=m&&_<=x)o=_;else if(N>=m&&N<=x)o=N}}}let h=Ce(o/i*100,0,100),g=Ce(p/r*100,0,100);e.style.left=`${h}%`,e.style.top=`${g}%`}getStorage(){try{return typeof localStorage<"u"?localStorage:typeof window<"u"?window.localStorage:null}catch{return null}}loadPosition(){try{let e=this.getStorage()?.getItem("gg:chatHeadsPos");if(!e)return{...Ye};let t=JSON.parse(e);if(fe(t)&&typeof t.xPct==="number"&&Number.isFinite(t.xPct)&&typeof t.yPct==="number"&&Number.isFinite(t.yPct))return{xPct:Ce(t.xPct),yPct:Ce(t.yPct)}}catch{}return{...Ye}}savePosition(e){try{this.getStorage()?.setItem("gg:chatHeadsPos",JSON.stringify(e))}catch{}}navigateToChat(e,t){try{let n=this.ctx.host?.surfaces;if(n&&typeof n.invoke==="function"){let i=n.invoke({kind:"route",id:"/chat/:chatId"},{chatId:e});if(Et(i)){Promise.resolve(i).then(()=>{t?.()},()=>{if(this.fallbackHistoryNavigate(e))t?.()});return}t?.();return}}catch{}if(this.fallbackHistoryNavigate(e))t?.()}fallbackHistoryNavigate(e){try{let t=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(t?.history&&typeof t.history.pushState==="function"){t.history.pushState(null,"",`/chat/${encodeURIComponent(e)}`);let n=t.PopStateEvent??(typeof PopStateEvent<"u"?PopStateEvent:Event);return t.dispatchEvent(new n("popstate")),!0}}catch{}return!1}safeGetActiveChat(){try{return this.ctx.getActiveChat?.()??null}catch{return null}}safeGetActiveChatId(){return this.safeGetActiveChat()?.chatId??null}}var we=["guided_response","guided_continue","guided_regenerate","guided_swipe","guided_impersonate"];var Je=0,Qe=!0,et=[{value:"before_post_history",label:"Before Post-History (after chat history)",shortLabel:"Before Post-History",sublabel:"Places guidance right after chat history and before post-history preset blocks."},{value:"in_history",label:"In History (at depth)",shortLabel:"In History",sublabel:"Splices guidance inside chat history N messages back from the end."},{value:"pre_history",label:"Pre-History (before chat history)",shortLabel:"Pre-History",sublabel:"Places guidance after pre-history system prompts and before the first chat turn."},{value:"post_history",label:"Post-History (end of prompt)",shortLabel:"Post-History",sublabel:"Appends guidance at the very end of the assembled prompt (before any trailing prefill)."}];function Le(e,t="before_post_history"){if(e==="before_post_history"||e==="in_history"||e==="pre_history"||e==="post_history")return e;return t}function tt(e,t=0){if(typeof e==="number"&&Number.isFinite(e))return Math.max(0,Math.min(999,Math.floor(e)));return Math.max(0,Math.min(999,Math.floor(t)))}var ke=[...we,"input_recovery"],me=[{value:"after_native",label:"Inline (after native buttons)",shortLabel:"Inline",sublabel:"Sits directly next to Home, Regenerate, Continue, etc."},{value:"before_native",label:"Left side (before native buttons)",shortLabel:"Left",sublabel:"Placed at the start of the composer top action bar"},{value:"right",label:"Right side (top bar)",shortLabel:"Right",sublabel:"Aligned to the right side of the composer top action bar"},{value:"below_bar",label:"Separate row (below native buttons)",shortLabel:"New row",sublabel:"Shown on the dedicated extension toolbar row underneath"}];function wt(e){return typeof e==="string"&&we.includes(e)}function It(e){return e==="input_recovery"||wt(e)}function ve(e){if(e==="after_native"||e==="before_native"||e==="right"||e==="below_bar")return e;return"after_native"}function Ie(e){let t=[],n=new Set;if(Array.isArray(e))for(let i of e){if(!It(i)||n.has(i))continue;n.add(i),t.push(i)}for(let i of ke)if(!n.has(i))n.add(i),t.push(i);return t}var de={guided_response:{id:"guided_response",label:"Guided Response",shortLabel:"Response",description:"Steer the next AI reply using your composer text as temporary guidance without adding a user message.",tooltip:"Guided Response — steer next AI reply without sending a user message"},guided_continue:{id:"guided_continue",label:"Guided Continue",shortLabel:"Continue",description:"Continue the last AI message using optional guidance text and this option's profile & preset.",tooltip:"Guided Continue — continue last AI message (guided if input present)"},guided_regenerate:{id:"guided_regenerate",label:"Guided Regenerate",shortLabel:"Regenerate",description:"Replace the last AI message with a fresh regenerated reply using optional guidance text and this option's profile & preset.",tooltip:"Guided Regenerate — regenerate last AI reply (guided if input present)"},guided_swipe:{id:"guided_swipe",label:"Guided Swipe",shortLabel:"Swipe",description:"Generate a new swipe on the last AI message steered by your guidance text.",tooltip:"Guided Swipe — create a steered new swipe on the last AI message"},guided_impersonate:{id:"guided_impersonate",label:"Impersonation",shortLabel:"Impersonate",description:"Generate a user reply into the composer input box using your configured preset and optional outline.",tooltip:"Impersonate — draft user message into input box"}};var nt='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',it='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',be={guided_response:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg>',guided_continue:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>',guided_regenerate:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',guided_swipe:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',guided_impersonate:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',input_recovery:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>'},De={remove_last_continue:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>',regenerate_last_continue:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>'},He={history:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>',clear_history:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'};function pe(e,t=68){let n=Number.isFinite(t)?Math.max(4,Math.floor(t)):60,i=e.replace(/\s+/g," ").trim();if(i.length<=n)return i;return`${i.slice(0,n-1)}…`}function rt(e,t){if(e.length===0)return null;if(t)return e.find((n)=>n.id===t)??e[0]??null;return e[0]??null}function ot(e){return e[0]?.text?` ("${e[0].text.replace(/\s+/g," ").trim().slice(0,48)}")`:""}function St(e){let t=ve(e.settings.toolbarPlacement),n=Ie(e.settings.buttonOrder),i=0;if(e.settings.actions.guided_response?.enabled)i|=1;if(e.settings.actions.guided_continue?.enabled)i|=2;if(e.settings.actions.guided_regenerate?.enabled)i|=4;if(e.settings.actions.guided_swipe?.enabled)i|=8;if(e.settings.actions.guided_impersonate?.enabled)i|=16;if(e.settings.inputRecovery.enabled)i|=32;let s=Boolean(e.settings.inputRecovery.enabled)&&e.recovery.length>0;return{placement:t,order:n,enabledMask:i,hasActiveChat:Boolean(e.hasActiveChat),hasActiveRun:Boolean(e.activeRun),activeRunId:e.activeRun?.runId??null,activeRunActionId:e.activeRun?.actionId??null,hasRecovery:s,latestRecoveryPreview:s?ot(e.recovery):""}}function Rt(e,t){if(e.placement!==t.placement||e.enabledMask!==t.enabledMask||e.hasActiveChat!==t.hasActiveChat||e.hasActiveRun!==t.hasActiveRun||e.activeRunId!==t.activeRunId||e.activeRunActionId!==t.activeRunActionId||e.hasRecovery!==t.hasRecovery||e.latestRecoveryPreview!==t.latestRecoveryPreview||e.order.length!==t.order.length)return!1;for(let n=0;n<e.order.length;n+=1)if(e.order[n]!==t.order[n])return!1;return!0}var Ne=["gg-actions-host","gg-actions-host--row","is-before-native","is-right"],At=450,Tt=10,Se=150,st=3000,Mt=0,Pt=250;class Fe{ctx;handlers;actionsMountRoot;toolbarMountRoot=null;toolbarEl;buttons=[];activeActionId=null;activeHoldCancel=null;suppressNextHoldClick=!1;suppressHoldClickActionId=null;suppressHoldClickUntil=0;clearSuppressHoldClickTimer=null;holdReleaseCleanup=null;postHoldCleanup=null;continueMenu=null;latestRecovery=[];lastRenderSignature=null;lastChatId=void 0;destroyed=!1;onKeyDown;onFocusIn;constructor(e,t){this.ctx=e;this.handlers=t;this.actionsMountRoot=e.ui.mount("chat_actions"),this.actionsMountRoot.classList.add("gg-actions-host"),this.toolbarEl=document.createElement("div"),this.toolbarEl.className="gg-toolbar",this.toolbarEl.setAttribute("role","toolbar"),this.toolbarEl.setAttribute("aria-label","Guided Generations actions"),this.onKeyDown=(n)=>{this.handleToolbarKeyDown(n)},this.onFocusIn=(n)=>{let i=n.target;if(!i||i.tagName!=="BUTTON"||i.disabled)return;let r=i.getAttribute("data-gg-action");if(r)this.activeActionId=r,this.applyRovingTabIndex()},this.toolbarEl.addEventListener("keydown",this.onKeyDown),this.toolbarEl.addEventListener("focusin",this.onFocusIn),this.actionsMountRoot.replaceChildren(this.toolbarEl)}render(e){if(this.destroyed)return;let t=e.chatId!==void 0&&this.lastChatId!==void 0&&e.chatId!==this.lastChatId;if(e.chatId!==void 0)this.lastChatId=e.chatId;let n=St(e),i=n.placement==="below_bar"?this.toolbarMountRoot:this.actionsMountRoot,r=i!==null&&this.toolbarEl.parentElement===i&&this.toolbarEl.childElementCount===this.buttons.length;if(this.lastRenderSignature!==null&&r&&Rt(this.lastRenderSignature,n)){if(this.latestRecovery=e.recovery,t)this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold();else if(this.continueMenu?.kind==="recovery")this.continueMenu.refreshRecovery?.();return}let s=typeof document<"u"?document.activeElement:null,l=s&&this.toolbarEl.contains(s)?s.getAttribute?.("data-gg-action"):null;this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold(),this.latestRecovery=e.recovery;let d=[];for(let p of n.order){let h=p==="input_recovery"?this.buildRecoveryButton(e):this.buildActionButton(p,e);if(h)d.push(h)}this.buttons=d,this.toolbarEl.replaceChildren(...d),this.applyRovingTabIndex();let o=d.length>0;if(this.applyPlacement(n.placement,o),this.lastRenderSignature=n,l){let p=this.buttons.find((h)=>!h.disabled&&h.getAttribute("data-gg-action")===l);if(p)this.activeActionId=l,this.applyRovingTabIndex(),p.focus()}}applyRovingTabIndex(){let e=this.buttons.filter((n)=>!n.disabled);if(e.length===0){for(let n of this.buttons)n.tabIndex=-1;return}let t=(this.activeActionId?e.find((n)=>n.getAttribute("data-gg-action")===this.activeActionId):void 0)??e[0];this.activeActionId=t.getAttribute("data-gg-action")??null;for(let n of this.buttons)n.tabIndex=n===t?0:-1}handleToolbarKeyDown(e){if(e.altKey||e.ctrlKey||e.metaKey)return;let t=e.key;if(t!=="ArrowRight"&&t!=="ArrowLeft"&&t!=="ArrowDown"&&t!=="ArrowUp"&&t!=="Home"&&t!=="End")return;let n=this.buttons.filter((d)=>!d.disabled);if(n.length===0)return;let i=typeof document<"u"?document.activeElement:null,r=n.findIndex((d)=>d===i);if(r===-1)r=n.findIndex((d)=>d.tabIndex===0);if(r===-1)r=0;let s=r;if(t==="ArrowRight"||t==="ArrowDown")s=(r+1)%n.length;else if(t==="ArrowLeft"||t==="ArrowUp")s=(r-1+n.length)%n.length;else if(t==="Home")s=0;else if(t==="End")s=n.length-1;let l=n[s];e.preventDefault(),this.activeActionId=l.getAttribute("data-gg-action")??null,this.applyRovingTabIndex(),l.focus()}buildActionButton(e,t){if(!t.settings.actions[e]?.enabled)return null;let i=de[e],r=t.activeRun?.actionId===e,s=Boolean(t.activeRun)&&!r,l=!t.hasActiveChat||s,d=document.createElement("button");if(d.type="button",d.className="gg-btn",r)d.classList.add("is-running");if(l)d.classList.add("is-dimmed");if(d.disabled=l,d.setAttribute("data-gg-action",e),d.setAttribute("aria-label",r?`Stop ${i.label}`:i.label),e==="guided_swipe"&&!r)d.setAttribute("aria-keyshortcuts","Control+Enter Meta+Enter"),d.title="Guided Swipe — click to swipe, hold (or Ctrl+Click) to swipe in background";else if(e==="guided_continue"&&!r)d.setAttribute("aria-haspopup","menu"),d.setAttribute("aria-expanded","false"),d.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter"),d.title="Guided Continue — click to continue, hold for continue options";else d.title=r?`Stop ${i.label}`:i.tooltip;if(d.innerHTML=r?it:be[e],e==="guided_swipe")this.attachSwipeHoldHandlers(d,t,r,l);else if(e==="guided_continue")this.attachContinueHoldHandlers(d,t,r,l);else d.addEventListener("click",(o)=>{if(o.preventDefault(),o.stopPropagation(),r&&t.activeRun)this.handlers.onAbortAction(t.activeRun.runId);else this.handlers.onTriggerAction(e)});return d}clearActiveHold(){if(this.activeHoldCancel){let e=this.activeHoldCancel;this.activeHoldCancel=null,e()}}clearPostHoldClickSuppression(){if(this.suppressNextHoldClick=!1,this.suppressHoldClickActionId=null,this.suppressHoldClickUntil=0,this.clearSuppressHoldClickTimer!==null)clearTimeout(this.clearSuppressHoldClickTimer),this.clearSuppressHoldClickTimer=null;if(this.holdReleaseCleanup){let e=this.holdReleaseCleanup;this.holdReleaseCleanup=null,e()}if(this.postHoldCleanup){let e=this.postHoldCleanup;this.postHoldCleanup=null,e()}}isHoldClickSuppressed(e){if(!this.suppressNextHoldClick)return!1;if(this.suppressHoldClickUntil>0&&Date.now()>this.suppressHoldClickUntil)return this.clearPostHoldClickSuppression(),!1;if(e&&this.suppressHoldClickActionId!==null){if(e.getAttribute("data-gg-action")!==this.suppressHoldClickActionId)return!1}return!0}armPostHoldClickSuppression(e,t){if(this.clearPostHoldClickSuppression(),this.suppressNextHoldClick=!0,this.suppressHoldClickActionId=e.getAttribute("data-gg-action"),this.suppressHoldClickUntil=Date.now()+st,this.postHoldCleanup=t??null,typeof document>"u")return;let n=typeof window<"u"?window:document.defaultView,i=()=>{if(document.removeEventListener("pointerup",l,!0),document.removeEventListener("pointercancel",l,!0),document.removeEventListener("visibilitychange",s),n?.removeEventListener("blur",r),this.holdReleaseCleanup===i)this.holdReleaseCleanup=null},r=()=>{this.clearPostHoldClickSuppression()},s=()=>{if(document.visibilityState==="hidden")this.clearPostHoldClickSuppression()},l=(d)=>{if(i(),this.clearSuppressHoldClickTimer!==null)clearTimeout(this.clearSuppressHoldClickTimer);let o=d.type==="pointercancel"||d.pointerType==="mouse"?Mt:Pt;this.suppressHoldClickUntil=Date.now()+o,this.clearSuppressHoldClickTimer=setTimeout(()=>{this.clearSuppressHoldClickTimer=null,this.clearPostHoldClickSuppression()},o)};this.holdReleaseCleanup=i,document.addEventListener("pointerup",l,!0),document.addEventListener("pointercancel",l,!0),document.addEventListener("visibilitychange",s),n?.addEventListener("blur",r),this.clearSuppressHoldClickTimer=setTimeout(()=>{this.clearSuppressHoldClickTimer=null,this.clearPostHoldClickSuppression()},st)}attachLongPressHandlers(e,t,n,i,r){let s={timer:void 0,x:0,y:0,fired:!1},l=typeof document<"u"?document:null,d=typeof window<"u"?window:l?.defaultView??null,o=!1,p=()=>{if(!o)return;o=!1,d?.removeEventListener("blur",g),l?.removeEventListener("visibilitychange",g)},h=()=>{if(o)return;o=!0,d?.addEventListener("blur",g),l?.addEventListener("visibilitychange",g)},g=()=>{if(p(),s.timer!==void 0)clearTimeout(s.timer),s.timer=void 0;if(e.classList.remove("is-holding"),this.activeHoldCancel===g)this.activeHoldCancel=null};e.addEventListener("pointerdown",(a)=>{if(i||t.activeRun)return;if(!a.isPrimary)return;if(a.pointerType==="mouse"&&a.button!==0)return;this.clearActiveHold(),this.clearPostHoldClickSuppression(),g(),s.fired=!1,s.x=a.clientX,s.y=a.clientY,e.classList.add("is-holding"),this.activeHoldCancel=g,h(),s.timer=setTimeout(()=>{if(s.timer=void 0,p(),e.classList.remove("is-holding"),this.activeHoldCancel===g)this.activeHoldCancel=null;s.fired=!0,this.armPostHoldClickSuppression(e,()=>{s.fired=!1}),r.onHold()},At)}),e.addEventListener("pointermove",(a)=>{if(s.timer===void 0)return;let m=a.clientX-s.x,x=a.clientY-s.y;if(Math.hypot(m,x)>Tt)g()}),e.addEventListener("pointerup",g),e.addEventListener("pointercancel",g),e.addEventListener("pointerleave",(a)=>{if(a.pointerType==="touch")return;g()}),e.addEventListener("contextmenu",(a)=>{if(s.timer!==void 0||s.fired||this.isHoldClickSuppressed(e))a.preventDefault(),a.stopPropagation()}),e.addEventListener("click",(a)=>{if(s.fired||this.isHoldClickSuppressed(e)){s.fired=!1,this.clearPostHoldClickSuppression(),a.preventDefault(),a.stopPropagation();return}if(a.preventDefault(),a.stopPropagation(),n&&t.activeRun)this.handlers.onAbortAction(t.activeRun.runId);else r.onClick(a)}),e.addEventListener("keydown",(a)=>{if(i||n||t.activeRun)return;if(r.onShortcutKeyDown(a))a.preventDefault(),a.stopPropagation()})}attachSwipeHoldHandlers(e,t,n,i){this.attachLongPressHandlers(e,t,n,i,{onClick:(r)=>{this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:Boolean(r.ctrlKey||r.metaKey)})},onHold:()=>{this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:!0})},onShortcutKeyDown:(r)=>{if((r.ctrlKey||r.metaKey)&&(r.key==="Enter"||r.key===" "))return this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:!0}),!0;return!1}})}attachContinueHoldHandlers(e,t,n,i){this.attachLongPressHandlers(e,t,n,i,{onClick:(r)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),r.ctrlKey||r.metaKey){this.openContinueMenu(e);return}this.handlers.onTriggerAction("guided_continue")},onHold:()=>{this.openContinueMenu(e)},onShortcutKeyDown:(r)=>{if(r.shiftKey&&r.key==="F10"||r.altKey&&r.key==="ArrowUp"||(r.ctrlKey||r.metaKey)&&r.key==="Enter")return this.openContinueMenu(e),!0;return!1}})}openContinueMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;this.closeContinueMenu({restoreFocus:!1});let t=document.createElement("div");t.className="gg-dropup-menu",t.setAttribute("role","menu"),t.setAttribute("aria-label","Guided Continue options");let n=[{id:"remove_last_continue",label:"Remove the last continue",icon:De.remove_last_continue,onSelect:()=>this.handlers.onRemoveLastContinue()},{id:"regenerate_last_continue",label:"Regenerate last continue",icon:De.regenerate_last_continue,onSelect:()=>this.handlers.onRegenerateLastContinue()}],i=[];for(let E of n){let b=document.createElement("button");b.type="button",b.className="gg-dropup-item",b.setAttribute("role","menuitem"),b.setAttribute("data-gg-menu-action",E.id),b.tabIndex=-1,b.innerHTML=`${E.icon}<span>${E.label}</span>`,b.addEventListener("click",(_)=>{_.preventDefault(),_.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),E.onSelect()}),i.push(b),t.append(b)}document.body.append(t),e.setAttribute("aria-expanded","true"),this.positionContinueMenu(t,e);let r=Date.now(),s=(E)=>{let b=i.indexOf(document.activeElement);if(E.key==="ArrowDown"){E.preventDefault(),E.stopPropagation();let _=b===-1?0:(b+1)%i.length;i[_]?.focus()}else if(E.key==="ArrowUp"){E.preventDefault(),E.stopPropagation();let _=b<=0?i.length-1:b-1;i[_]?.focus()}else if(E.key==="Home")E.preventDefault(),E.stopPropagation(),i[0]?.focus();else if(E.key==="End")E.preventDefault(),E.stopPropagation(),i[i.length-1]?.focus();else if(E.key==="Escape")E.preventDefault(),E.stopPropagation(),this.closeContinueMenu({restoreFocus:!0});else if(E.key==="Tab")E.preventDefault(),E.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},l=(E)=>{if(E.key==="Escape")E.preventDefault(),E.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},d=(E)=>{if(Date.now()-r<Se)return;let b=E.target;if(b&&(t.contains(b)||b===e||e.contains(b)))return;this.closeContinueMenu({restoreFocus:!1})},o=(E)=>{if(this.isHoldClickSuppressed(e))return;if(Date.now()-r<Se)return;let b=E.target;if(b&&(t.contains(b)||b===e||e.contains(b)))return;this.closeContinueMenu({restoreFocus:!1})},p=typeof window<"u"?window:document.defaultView,h=p?.visualViewport??null,g=p?.innerWidth,a=p?.innerHeight,m=(E)=>{if(!e.isConnected||e.disabled||!t.isConnected){this.closeContinueMenu({restoreFocus:!1});return}let b=p?.innerWidth,_=p?.innerHeight,N=b!==g||_!==a;if(g=b,a=_,!E&&!h&&!N){this.closeContinueMenu({restoreFocus:!1});return}this.positionContinueMenu(t,e)},x=()=>{m(!1)},u=()=>{m(!0)},T=(E)=>{let b=E.target;if(b&&t.contains(b))return;this.closeContinueMenu({restoreFocus:!1})};if(t.addEventListener("keydown",s),document.addEventListener("keydown",l,!0),document.addEventListener("pointerdown",d,!0),document.addEventListener("click",o,!0),document.addEventListener("scroll",T,!0),p)p.addEventListener("resize",x),p.addEventListener("scroll",T,!0);h?.addEventListener("resize",u);let R=()=>{if(t.removeEventListener("keydown",s),document.removeEventListener("keydown",l,!0),document.removeEventListener("pointerdown",d,!0),document.removeEventListener("click",o,!0),document.removeEventListener("scroll",T,!0),p)p.removeEventListener("resize",x),p.removeEventListener("scroll",T,!0);h?.removeEventListener("resize",u),t.remove()};this.continueMenu={kind:"continue",menuEl:t,anchorBtn:e,items:i,cleanup:R},i[0]?.focus()}positionContinueMenu(e,t){let n=t.getBoundingClientRect(),i=typeof window<"u"?window:document.defaultView,r=typeof getComputedStyle==="function"?getComputedStyle:i?.getComputedStyle?.bind(i),s=r&&document.body?r(document.body):null,l=s?parseFloat(s.zoom):NaN,d=s&&typeof s.getPropertyValue==="function"?parseFloat(s.getPropertyValue("scale")):NaN,o=s&&typeof s.getPropertyValue==="function"?parseFloat(s.getPropertyValue("--lumiverse-ui-scale")):NaN,p=Number.isFinite(l)&&l>0&&l!==1?l:Number.isFinite(d)&&d>0&&d!==1?d:Number.isFinite(o)&&o>0&&o!==1?o:1,h=i&&typeof i.innerWidth==="number"?i.innerWidth:document.documentElement?.clientWidth||1024,g=i&&typeof i.innerHeight==="number"?i.innerHeight:document.documentElement?.clientHeight||768,a=i?.visualViewport,m=a&&typeof a.width==="number"&&Number.isFinite(a.width)&&a.width>0&&a.width<h?a.width:h,x=a&&typeof a.height==="number"&&Number.isFinite(a.height)&&a.height>0&&a.height<g?a.height:g;e.style.maxHeight="",e.style.overflowY="";let u=e.querySelector(".gg-dropup-history-list");if(u)u.style.maxHeight="";let T=e.offsetWidth*p,R=e.offsetHeight*p,E=6,b=8,_=Math.max(b,m-T-b),N=Math.max(b,Math.min(n.left,_));e.style.left=`${N/p}px`;let k=n.top,L=x-n.bottom,y=R+E*p+b,C;if(k<y&&L>k){let S=Math.max(b/p,n.bottom/p+E);e.style.top=`${S}px`,e.style.bottom="",C=Math.max(0,x-S*p-b)}else e.style.bottom=`${(x-n.top)/p+E}px`,e.style.top="",C=Math.max(0,k-E*p-b);let I=Math.max(0,Math.floor(C/p));if(e.style.maxHeight=`${I}px`,e.style.overflowY="auto",u){let S=e.querySelector(".gg-dropup-header"),P=u.offsetHeight>0&&e.offsetHeight>=u.offsetHeight?e.offsetHeight-u.offsetHeight:(S?.offsetHeight||32)+12,A=Math.min(220,Math.max(0,I-P));u.style.maxHeight=`${A}px`}}closeContinueMenu(e){let t=this.continueMenu;if(!t)return;if(this.continueMenu=null,t.anchorBtn.setAttribute("aria-expanded","false"),t.cleanup(),e.restoreFocus&&t.anchorBtn.isConnected&&!t.anchorBtn.disabled)t.anchorBtn.focus()}buildRecoveryButton(e){if(!e.settings.inputRecovery.enabled)return null;let t=e.recovery.length>0,n=Boolean(e.activeRun),i=ot(e.recovery),r=document.createElement("button");if(r.type="button",r.className="gg-btn",n)r.classList.add("is-dimmed");if(r.disabled=n,r.setAttribute("data-gg-action","input_recovery"),r.setAttribute("aria-label",t?"Restore last input":"Clear current input"),!n)r.setAttribute("aria-haspopup","menu"),r.setAttribute("aria-expanded","false"),r.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter");return r.title=t?`Restore last cleared input${i}`:"Input Recovery — clear current input",r.innerHTML=be.input_recovery,this.attachRecoveryHoldHandlers(r,e,n),r}attachRecoveryHoldHandlers(e,t,n){this.attachLongPressHandlers(e,t,!1,n,{onClick:(i)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),i.ctrlKey||i.metaKey){this.openRecoveryMenu(e);return}this.handlers.onRestoreLatest()},onHold:()=>{this.openRecoveryMenu(e)},onShortcutKeyDown:(i)=>{if(i.shiftKey&&i.key==="F10"||i.altKey&&i.key==="ArrowUp"||(i.ctrlKey||i.metaKey)&&i.key==="Enter")return this.openRecoveryMenu(e),!0;return!1}})}openRecoveryMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;this.closeContinueMenu({restoreFocus:!1});let t=document.createElement("div");t.className="gg-dropup-menu",t.setAttribute("role","menu"),t.setAttribute("aria-label","Input Recovery options");let n=[],i=!1,r=()=>this.latestRecovery.map((y)=>({id:y.id,text:y.text,actionId:y.actionId})),s=r(),l=()=>{if(s.length!==this.latestRecovery.length)return!0;for(let y=0;y<s.length;y+=1){let C=s[y],I=this.latestRecovery[y];if(C.id!==I.id||C.text!==I.text||C.actionId!==I.actionId)return!0}return!1},d=(y=!0)=>{i=!1,s=r(),n.length=0,t.replaceChildren(),t.setAttribute("aria-label","Input Recovery options");let C=this.latestRecovery.length===0,I=[{id:"history",label:"History",icon:He.history,disabled:!1,onSelect:()=>{o()}},{id:"clear_history",label:"Clear History",icon:He.clear_history,disabled:C,onSelect:()=>{if(this.latestRecovery.length===0)return;this.closeContinueMenu({restoreFocus:!1}),this.handlers.onClearRecovery?.()}}];for(let S of I){let P=document.createElement("button");if(P.type="button",P.className="gg-dropup-item",P.setAttribute("role","menuitem"),P.setAttribute("data-gg-menu-action",S.id),P.tabIndex=-1,S.disabled)P.disabled=!0,P.setAttribute("aria-disabled","true"),P.style.opacity="0.45",P.style.cursor="not-allowed";P.innerHTML=`${S.icon}<span>${S.label}</span>`,P.addEventListener("click",(A)=>{if(A.preventDefault(),A.stopPropagation(),S.disabled)return;S.onSelect()}),n.push(P),t.append(P)}if(t.isConnected){if(this.positionContinueMenu(t,e),y)n[0]?.focus()}},o=(y=!0)=>{i=!0,s=r(),n.length=0,t.replaceChildren(),t.setAttribute("aria-label","Input Recovery History");let C=document.createElement("div");C.className="gg-dropup-header",C.style.flexShrink="0";let I=document.createElement("button");I.type="button",I.className="gg-dropup-back",I.setAttribute("data-gg-menu-action","back"),I.setAttribute("aria-label","Back to Input Recovery options"),I.setAttribute("aria-keyshortcuts","ArrowLeft Backspace"),I.tabIndex=-1,I.textContent="← Back",I.addEventListener("click",(A)=>{A.preventDefault(),A.stopPropagation(),d()});let S=document.createElement("span");S.className="gg-dropup-title",S.textContent=`History (${this.latestRecovery.length})`,C.append(I,S),t.append(C),n.push(I);let P=document.createElement("div");if(P.className="gg-dropup-history-list",P.style.minHeight="0",this.latestRecovery.length===0){let A=document.createElement("div");A.className="gg-dropup-empty",A.setAttribute("role","status"),A.textContent="No saved inputs yet.",P.append(A),t.append(P)}else{for(let A of this.latestRecovery){let Y=de[A.actionId]?.label??A.actionId,X=pe(A.text,56),F=document.createElement("button");F.type="button",F.className="gg-dropup-item gg-dropup-history-item",F.setAttribute("role","menuitem"),F.setAttribute("data-gg-menu-action","restore_recovery_entry"),F.setAttribute("data-gg-recovery-id",A.id),F.setAttribute("aria-label",`Restore ${Y} draft: ${pe(A.text,40)}`),F.title=A.text,F.tabIndex=-1;let K=document.createElement("span");K.className="gg-dropup-history-tag",K.textContent=Y;let j=document.createElement("span");j.className="gg-dropup-history-snippet",j.textContent=X,F.append(K,j),F.addEventListener("click",(q)=>{if(q.preventDefault(),q.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),this.handlers.onRestoreEntry)this.handlers.onRestoreEntry(A);else this.handlers.onRestoreLatest()}),n.push(F),P.append(F)}t.append(P)}if(t.isConnected){if(this.positionContinueMenu(t,e),y)(this.latestRecovery.length>0?n[1]??n[0]:n[0])?.focus()}},p=()=>{if(!l())return;let y=typeof document<"u"?document.activeElement:null,C=Boolean(y&&t.contains(y)),I=C?y.getAttribute?.("data-gg-recovery-id"):null,S=C?y.getAttribute?.("data-gg-menu-action"):null;if(i)o(!1);else d(!1);if(C)((I?n.find((A)=>!A.disabled&&A.getAttribute("data-gg-recovery-id")===I):void 0)??(S?n.find((A)=>!A.disabled&&A.getAttribute("data-gg-menu-action")===S):void 0)??n.find((A)=>!A.disabled))?.focus()};d(),document.body.append(t),e.setAttribute("aria-expanded","true"),this.positionContinueMenu(t,e);let h=Date.now(),g=(y)=>{let C=n.filter((S)=>!S.disabled),I=C.indexOf(document.activeElement);if(y.key==="ArrowDown"){if(y.preventDefault(),y.stopPropagation(),C.length===0)return;let S=I===-1?0:(I+1)%C.length;C[S]?.focus()}else if(y.key==="ArrowUp"){if(y.preventDefault(),y.stopPropagation(),C.length===0)return;let S=I<=0?C.length-1:I-1;C[S]?.focus()}else if(y.key==="Home")y.preventDefault(),y.stopPropagation(),C[0]?.focus();else if(y.key==="End")y.preventDefault(),y.stopPropagation(),C[C.length-1]?.focus();else if(i&&(y.key==="ArrowLeft"||y.key==="Backspace"))y.preventDefault(),y.stopPropagation(),d();else if(y.key==="Escape")y.preventDefault(),y.stopPropagation(),this.closeContinueMenu({restoreFocus:!0});else if(y.key==="Tab")y.preventDefault(),y.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},a=(y)=>{if(y.key==="Escape")y.preventDefault(),y.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},m=(y)=>{if(Date.now()-h<Se)return;let C=y.target;if(C&&(t.contains(C)||C===e||e.contains(C)))return;this.closeContinueMenu({restoreFocus:!1})},x=(y)=>{if(this.isHoldClickSuppressed(e))return;if(Date.now()-h<Se)return;let C=y.target;if(C&&(t.contains(C)||C===e||e.contains(C)))return;this.closeContinueMenu({restoreFocus:!1})},u=typeof window<"u"?window:document.defaultView,T=u?.visualViewport??null,R=u?.innerWidth,E=u?.innerHeight,b=(y)=>{if(!e.isConnected||e.disabled||!t.isConnected){this.closeContinueMenu({restoreFocus:!1});return}let C=u?.innerWidth,I=u?.innerHeight,S=C!==R||I!==E;if(R=C,E=I,!y&&!T&&!S){this.closeContinueMenu({restoreFocus:!1});return}this.positionContinueMenu(t,e)},_=()=>{b(!1)},N=()=>{b(!0)},k=(y)=>{let C=y.target;if(C&&t.contains(C))return;this.closeContinueMenu({restoreFocus:!1})};if(t.addEventListener("keydown",g),document.addEventListener("keydown",a,!0),document.addEventListener("pointerdown",m,!0),document.addEventListener("click",x,!0),document.addEventListener("scroll",k,!0),u)u.addEventListener("resize",_),u.addEventListener("scroll",k,!0);T?.addEventListener("resize",N);let L=()=>{if(t.removeEventListener("keydown",g),document.removeEventListener("keydown",a,!0),document.removeEventListener("pointerdown",m,!0),document.removeEventListener("click",x,!0),document.removeEventListener("scroll",k,!0),u)u.removeEventListener("resize",_),u.removeEventListener("scroll",k,!0);T?.removeEventListener("resize",N),t.remove()};this.continueMenu={kind:"recovery",menuEl:t,anchorBtn:e,items:n,cleanup:L,refreshRecovery:p},n[0]?.focus()}applyPlacement(e,t){if(this.toolbarEl.style.display=t?"inline-flex":"none",e==="below_bar"){if(!this.toolbarMountRoot)this.toolbarMountRoot=this.ctx.ui.mount("chat_toolbar");if(this.resetHostElement(this.actionsMountRoot,!0),this.toolbarMountRoot.classList.remove(...Ne),this.toolbarMountRoot.classList.add("gg-actions-host--row"),this.toolbarMountRoot.style.display=t?"flex":"none",this.toolbarEl.parentElement!==this.toolbarMountRoot)this.toolbarMountRoot.replaceChildren(this.toolbarEl);return}if(this.toolbarMountRoot)this.resetHostElement(this.toolbarMountRoot,!0);if(this.actionsMountRoot.classList.remove(...Ne),this.actionsMountRoot.classList.add("gg-actions-host"),e==="before_native")this.actionsMountRoot.classList.add("is-before-native");else if(e==="right")this.actionsMountRoot.classList.add("is-right");if(this.actionsMountRoot.style.display=t?"inline-flex":"none",this.toolbarEl.parentElement!==this.actionsMountRoot)this.actionsMountRoot.replaceChildren(this.toolbarEl)}resetHostElement(e,t){if(e.classList.remove(...Ne),e.style.display="none",t)e.replaceChildren()}destroy(){if(this.destroyed)return;if(this.destroyed=!0,this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold(),this.clearPostHoldClickSuppression(),this.toolbarEl.removeEventListener("keydown",this.onKeyDown),this.toolbarEl.removeEventListener("focusin",this.onFocusIn),this.buttons=[],this.activeActionId=null,this.lastRenderSignature=null,this.lastChatId=void 0,this.toolbarEl.replaceChildren(),this.resetHostElement(this.actionsMountRoot,!0),this.toolbarMountRoot)this.resetHostElement(this.toolbarMountRoot,!0)}}var at=[0,50,150];function ee(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function lt(e){let t=Array.isArray(e)?e:ee(e)&&Array.isArray(e.data)?e.data:ee(e)&&Array.isArray(e.items)?e.items:[],n=[];for(let i of t)if(ee(i)&&typeof i.id==="string")n.push(i);return n}function dt(e,t,n){if(t>=n)return!0;if(ee(e)&&typeof e.total==="number"&&e.total>t)return!0;return!1}function _t(e){let n=(e instanceof Error?e.message:typeof e==="string"?e:"").toUpperCase();return n.includes("PERMISSION_DENIED")||n.includes("SPINDLE_FRONTEND_INACTIVE")||n.includes("STALE_GENERATION")||n.includes("NOT FOUND")||n.includes("404")||n.includes("403")||n.includes("401")}class Oe{ctx;pending=new Map;scheduledKeys=new Set;inFlightByMessage=new Map;retryTimers=new Map;nextRevision=0;destroyed=!1;constructor(e){this.ctx=e}makeKey(e,t,n){return`${e}:${t}:${n}`}handleMetricsEvent(e){if(this.destroyed)return;if(typeof e.chatId!=="string"||!e.chatId||typeof e.messageId!=="string"||!e.messageId||typeof e.swipeId!=="number"||!Number.isInteger(e.swipeId)||e.swipeId<0)return;if(e.tokenCount===void 0&&e.generationMetrics===void 0)return;let t=this.makeKey(e.chatId,e.messageId,e.swipeId),n=this.pending.get(t),i={key:t,chatId:e.chatId,messageId:e.messageId,swipeId:e.swipeId,tokenCount:e.tokenCount!==void 0?e.tokenCount:n?.tokenCount,generationMetrics:e.generationMetrics!==void 0?e.generationMetrics:n?.generationMetrics,latestFallback:n?.latestFallback??null,revision:++this.nextRevision,attempts:0};this.pending.set(t,i),this.clearRetryTimer(t),this.enqueueFlush(t)}onMessageEvent(e){if(this.destroyed||this.pending.size===0)return;let t=ee(e)?e:null,n=t&&ee(t.message)?t.message:null,i=typeof n?.id==="string"?n.id:typeof t?.messageId==="string"?t.messageId:null;if(!i)return;let r=typeof t?.chatId==="string"?t.chatId:typeof n?.chat_id==="string"?n.chat_id:null,s=typeof t?.action==="string"?t.action:null,l=s==="deleted"&&typeof t?.swipeId==="number"?t.swipeId:null,d=typeof n?.swipe_id==="number"?n.swipe_id:s!=="deleted"&&typeof t?.swipeId==="number"?t.swipeId:void 0,o=n&&typeof n.id==="string"?n:null;if(l!==null){let p=[];for(let[h,g]of[...this.pending.entries()]){if(g.messageId!==i)continue;if(r&&g.chatId!==r)continue;if(g.swipeId===l)this.pending.delete(h),this.scheduledKeys.delete(h),this.clearRetryTimer(h);else if(g.swipeId>l){this.pending.delete(h),this.scheduledKeys.delete(h),this.clearRetryTimer(h);let a=g.swipeId-1;p.push({...g,swipeId:a,latestFallback:null,key:this.makeKey(g.chatId,g.messageId,a),revision:++this.nextRevision})}}for(let h of p){let g=this.pending.get(h.key);if(!g||h.revision>g.revision)this.scheduledKeys.delete(h.key),this.clearRetryTimer(h.key),this.pending.set(h.key,h)}}for(let[p,h]of[...this.pending.entries()]){if(h.messageId!==i)continue;if(r&&h.chatId!==r)continue;if(d!==void 0&&d!==h.swipeId){if(o!==null)h.latestFallback=o;continue}h.attempts=0,this.enqueueFlush(p,o)}}onChatChanged(e){if(this.destroyed||this.pending.size===0)return;let t=typeof e==="string"&&e.length>0?e:this.safeGetActiveChatId();if(!t)return;for(let[n,i]of[...this.pending.entries()]){if(i.chatId!==t)continue;if(i.latestFallback&&typeof i.latestFallback.swipe_id==="number"&&i.latestFallback.swipe_id!==i.swipeId)continue;i.attempts=0,this.enqueueFlush(n)}}onChatDeleted(e){if(this.destroyed||!e||this.pending.size===0)return;for(let[t,n]of[...this.pending.entries()]){if(n.chatId!==e)continue;this.pending.delete(t),this.scheduledKeys.delete(t),this.clearRetryTimer(t)}}onMessageDeleted(e){if(this.destroyed||this.pending.size===0)return;let t=ee(e)?e:null,n=t&&ee(t.message)?t.message:null,i=typeof n?.id==="string"?n.id:typeof t?.messageId==="string"?t.messageId:typeof t?.id==="string"?t.id:null;if(!i)return;let r=typeof t?.chatId==="string"?t.chatId:typeof t?.chat_id==="string"?t.chat_id:typeof n?.chat_id==="string"?n.chat_id:null;for(let[s,l]of[...this.pending.entries()]){if(l.messageId!==i)continue;if(r&&l.chatId!==r)continue;this.pending.delete(s),this.scheduledKeys.delete(s),this.clearRetryTimer(s)}}destroy(){if(this.destroyed)return;this.destroyed=!0,this.pending.clear(),this.scheduledKeys.clear(),this.inFlightByMessage.clear();for(let e of this.retryTimers.values())clearTimeout(e);this.retryTimers.clear()}enqueueFlush(e,t=null){if(this.destroyed)return;let n=this.pending.get(e);if(!n)return;if(t!==null)n.latestFallback=t;if(this.scheduledKeys.has(e))return;this.scheduledKeys.add(e);let i=`${n.chatId}:${n.messageId}`,s=(this.inFlightByMessage.get(i)??Promise.resolve()).catch(()=>{return}).then(async()=>{if(this.scheduledKeys.delete(e),this.destroyed)return;await this.flushKey(e,t)}).catch(()=>{return}).finally(()=>{if(this.inFlightByMessage.get(i)===s)this.inFlightByMessage.delete(i)});this.inFlightByMessage.set(i,s)}async flushKey(e,t){if(this.destroyed)return;let n=this.pending.get(e);if(!n)return;let i={...n},r=i.latestFallback??t,s=this.resolveUpdateMessage();if(!s){this.deleteIfSameRevision(e,i.revision);return}let l=null,d=this.resolveGetMessages();if(d){let h;try{h=await d(i.chatId,{limit:50,tail:!0})}catch(a){if(this.destroyed)return;this.handleFlushFailure(e,i,a);return}if(this.destroyed)return;let g=lt(h);if(l=g.find((a)=>a.id===i.messageId)??null,!l){let a=dt(h,g.length,50);if(!a){this.deleteIfSameRevision(e,i.revision);return}let m=this.resolveGetSingleMessage();if(m)try{let x=await m(i.messageId);if(this.destroyed)return;if(ee(x)&&typeof x.id==="string"&&x.id===i.messageId&&(typeof x.chat_id!=="string"||x.chat_id===i.chatId))l=x}catch{}if(!l&&a)try{let x=await d(i.chatId,{limit:200,tail:!0});if(this.destroyed)return;let u=lt(x);if(l=u.find((T)=>T.id===i.messageId)??null,!l&&!dt(x,u.length,200)){this.deleteIfSameRevision(e,i.revision);return}}catch(x){if(this.destroyed)return;this.handleFlushFailure(e,i,x);return}if(!l)return}}else if(r&&r.id===i.messageId)l=r;else return;let o=this.pending.get(e);if(!o||o.revision!==i.revision)return;if(typeof l.swipe_id!=="number")return;if(l.swipe_id!==i.swipeId){o.latestFallback=l;return}let p={...ee(l.extra)?l.extra:{}};if(i.tokenCount!==void 0)p.tokenCount=i.tokenCount;if(i.generationMetrics!==void 0)p.generationMetrics=i.generationMetrics;try{await s(i.chatId,i.messageId,{extra:p})}catch(h){if(this.destroyed)return;this.handleFlushFailure(e,i,h);return}if(this.destroyed)return;this.deleteIfSameRevision(e,i.revision)}handleFlushFailure(e,t,n){let i=this.pending.get(e);if(!i||i.revision!==t.revision)return;if(_t(n)||t.attempts>=at.length){this.pending.delete(e);return}let r=at[t.attempts]??150;i.attempts=t.attempts+1,this.scheduleRetry(e,r)}deleteIfSameRevision(e,t){let n=this.pending.get(e);if(n&&n.revision===t)this.pending.delete(e)}scheduleRetry(e,t){if(this.destroyed||this.retryTimers.has(e))return;let n=setTimeout(()=>{if(this.retryTimers.delete(e),this.destroyed)return;this.enqueueFlush(e)},t);this.retryTimers.set(e,n)}clearRetryTimer(e){let t=this.retryTimers.get(e);if(t!==void 0)clearTimeout(t),this.retryTimers.delete(e)}resolveGetMessages(){try{let e=this.ctx.domain?.chats;if(typeof e?.getMessages==="function")return e.getMessages.bind(e);let t=this.ctx.chats;if(typeof t?.getMessages==="function")return t.getMessages.bind(t)}catch{}return null}resolveGetSingleMessage(){try{let e=this.ctx.messages;if(typeof e?.get==="function")return e.get.bind(e)}catch{}return null}resolveUpdateMessage(){try{let e=this.ctx.chats;if(typeof e?.updateMessage==="function")return e.updateMessage.bind(e)}catch{}return null}safeGetActiveChatId(){try{return this.ctx.getActiveChat?.().chatId??null}catch{return null}}}class Ve{ctx;handlers;tab;handles=[];currentSettings=null;expandedSections=new Set;debounceTimers=new Map;orderStateTags=new Map;rootEl=null;headerEl=null;noticeEl=null;recoveryUi=null;pendingView=null;pendingFocusRestore=null;pendingGeneralFocusRestore=null;pointerActiveInDrawer=!1;pointerReleaseCleanup=null;pointerFallbackTimer=null;pendingViewFlushTimer=null;tabConnectionCleanups=new Set;noticeText="";noticeKind="info";recoveryBusy=!1;destroyed=!1;onFocusOut;onPointerDownInDrawer;constructor(e,t){this.ctx=e;this.handlers=t;this.tab=e.ui.registerDrawerTab({id:"guided-generations-settings",title:"Guided Generations",shortName:"Guided",description:"Configure input-bar guided action buttons and per-option API connection profiles & presets.",keywords:["guided","continue","regenerate","swipe","impersonate","recovery","preset","profile"],iconSvg:nt});let n=()=>{if(this.pointerFallbackTimer!==null)clearTimeout(this.pointerFallbackTimer),this.pointerFallbackTimer=null;if(this.pointerReleaseCleanup){let i=this.pointerReleaseCleanup;this.pointerReleaseCleanup=null,i()}};this.onPointerDownInDrawer=()=>{if(this.destroyed||this.pointerActiveInDrawer)return;if(this.pointerActiveInDrawer=!0,n(),typeof document>"u"){this.pointerActiveInDrawer=!1;return}let i=typeof window<"u"?window:document.defaultView,r=()=>{if(n(),this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer);this.pendingViewFlushTimer=setTimeout(()=>{this.pendingViewFlushTimer=null,this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()},0)},s=()=>{n(),this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()};document.addEventListener("pointerup",r,!0),document.addEventListener("pointercancel",r,!0),document.addEventListener("mouseup",r,!0),i?.addEventListener("blur",s),this.pointerReleaseCleanup=()=>{document.removeEventListener("pointerup",r,!0),document.removeEventListener("pointercancel",r,!0),document.removeEventListener("mouseup",r,!0),i?.removeEventListener("blur",s)},this.pointerFallbackTimer=setTimeout(()=>{n(),this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()},3000)},this.onFocusOut=(i)=>{if(this.destroyed)return;let r=i.relatedTarget;if(this.debounceTimers.size>0&&r!==i.target)this.flushPendingSaves();if(!(Re(r)&&this.tab.root.contains(r)&&ct(r))&&this.pendingView)if(this.pointerActiveInDrawer||Lt(this.tab.root,r)){if(!this.pointerActiveInDrawer)this.scheduleDeferredPendingViewFlush()}else queueMicrotask(()=>{this.flushPendingViewIfIdle()})},this.tab.root.addEventListener("pointerdown",this.onPointerDownInDrawer),this.tab.root.addEventListener("mousedown",this.onPointerDownInDrawer),this.tab.root.addEventListener("focusout",this.onFocusOut)}scheduleDeferredPendingViewFlush(){if(this.destroyed||this.pendingViewFlushTimer!==null)return;this.pendingViewFlushTimer=setTimeout(()=>{this.pendingViewFlushTimer=null,this.flushPendingViewIfIdle()},0)}flushPendingViewIfIdle(){if(this.destroyed||this.pointerActiveInDrawer)return;if(this.pendingView&&!this.isEditingDrawerInput()){let e=this.currentSettings?{...this.pendingView,settings:this.currentSettings}:this.pendingView;this.pendingView=null,this.render(e,{force:!0})}}onActivate(e){return this.tab.onActivate(e)}isTabConnected(){if(this.destroyed)return!1;if(this.tab.root?.isConnected)return!0;try{let e=this.ctx.ui?.getTabLocation?.(this.tab.tabId);if(e&&e.kind!=="main-drawer")return!0}catch{}try{let e=this.ctx.ui?.events?.getDrawerState?.();if(e?.open&&e.tabId===this.tab.tabId)return!0}catch{}return!1}observeTabConnection(e){if(this.destroyed||typeof IntersectionObserver!=="function")return()=>{};let t=!0,n=()=>{if(!t)return;t=!1,this.tabConnectionCleanups.delete(n),i.disconnect()},i=new IntersectionObserver((r)=>{if(!t||this.destroyed){n();return}if(r.some((s)=>s.isIntersecting)||this.isTabConnected())n(),e()},{threshold:0});return this.tabConnectionCleanups.add(n),i.observe(this.tab.root),n}setNotice(e,t="info"){this.noticeText=e,this.noticeKind=t,this.syncNoticeElement()}syncNoticeElement(){if(this.destroyed||!this.rootEl||!this.headerEl)return;if(!this.noticeText){this.noticeEl?.remove(),this.noticeEl=null;return}if(!this.noticeEl)this.noticeEl=document.createElement("div"),this.headerEl.after(this.noticeEl);if(this.noticeEl.className=`gg-notice${this.noticeKind==="error"?" is-error":this.noticeKind==="warn"?" is-warn":""}`,this.noticeKind==="error"||this.noticeKind==="warn")this.noticeEl.setAttribute("role","alert"),this.noticeEl.setAttribute("aria-live","assertive");else this.noticeEl.setAttribute("role","status"),this.noticeEl.setAttribute("aria-live","polite");this.noticeEl.textContent=this.noticeText}setRecoveryBusy(e){if(this.destroyed)return;if(this.recoveryBusy=e,!this.recoveryUi)return;if(this.recoveryUi.clearBtn.disabled=e||this.recoveryUi.recoveryCount===0,this.recoveryUi.listEl)for(let t of this.recoveryUi.listEl.querySelectorAll("button"))t.disabled=e}updateRecovery(e,t){if(this.destroyed)return;if(this.pendingView)this.pendingView={...this.pendingView,recovery:[...e]};if(!this.recoveryUi)return;let n=t?.inputRecovery.maxEntries??this.currentSettings?.inputRecovery.maxEntries??10;this.recoveryUi.maxEntries=n,this.recoveryUi.recoveryCount=e.length,this.recoveryUi.setBadge(e.length>0?String(e.length):"",e.length===0),this.recoveryUi.countLabel.textContent=e.length>0?`Saved inputs (${e.length}/${n}):`:"No saved inputs yet.",this.recoveryUi.clearBtn.disabled=this.recoveryBusy||e.length===0,this.syncRecoveryList(e)}isEditingDrawerInput(){if(this.debounceTimers.size>0)return!0;let e=typeof document<"u"?document.activeElement:null;return Boolean(Re(e)&&this.tab.root.contains(e)&&ct(e))}captureOrderButtonFocus(){let e=typeof document<"u"?document.activeElement:null;if(!Re(e)||!this.tab.root.contains(e))return;if(!this.pendingFocusRestore&&e.tagName==="BUTTON"){let t=e,n=t.dataset.ggMove;if(n==="up"||n==="down"){let r=t.closest("[data-gg-order-id]")?.getAttribute("data-gg-order-id");if(r){this.pendingFocusRestore={optionId:r,button:n};return}}}if(!this.pendingFocusRestore&&!this.pendingGeneralFocusRestore){let t=e.getAttribute("data-gg-focus-key")??void 0,n=e.getAttribute("aria-label")??void 0;if(t||n)this.pendingGeneralFocusRestore={focusKey:t,tagName:e.tagName,ariaLabel:n}}}render(e,t){if(this.destroyed)return;if(!t?.force&&this.rootEl!==null&&this.currentSettings!==null&&this.isEditingDrawerInput()){if(e)this.pendingView=e,this.updateRecovery(e.recovery,e.settings);return}if(this.pendingView=null,this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer),this.pendingViewFlushTimer=null;this.captureOrderButtonFocus();let n=e;if(t?.force&&this.debounceTimers.size>0){if(this.flushPendingSaves(),n&&this.currentSettings)n={...n,settings:this.currentSettings}}else this.cancelPendingSaves();this.clearComponentHandles(),this.orderStateTags.clear(),this.recoveryUi=null,this.noticeEl=null,this.currentSettings=n?.settings??null;let i=document.createElement("div");i.className="gg-drawer",this.rootEl=i,this.tab.root.replaceChildren(i);let r=document.createElement("header");r.className="gg-header",this.headerEl=r;let s=document.createElement("div"),l=document.createElement("h2");l.textContent="Guided Generations";let d=document.createElement("p");d.className="gg-muted",d.textContent="Enabled options appear on the composer's top action bar alongside native buttons. Each option uses its own connection profile, model, and preset without modifying your active chat.",s.append(l,d);let o=document.createElement("button");if(o.type="button",o.className="gg-btn-sm",o.dataset.ggFocusKey="refresh",o.textContent="Refresh",o.addEventListener("click",()=>{this.flushPendingSaves(),this.handlers.onRefresh()}),r.append(s,o),i.append(r),this.syncNoticeElement(),!n){let u=document.createElement("p");u.className="gg-muted",u.textContent="Loading Guided Generations settings…",i.append(u),this.restoreCapturedFocus(i);return}let p=[];if(!n.permissions.generation)p.push("generation");if(!n.permissions.chats)p.push("chats");if(!n.permissions.chat_mutation)p.push("chat_mutation");if(!n.permissions.presets)p.push("presets");if(p.length>0){let u=document.createElement("div");u.className="gg-notice is-warn",u.setAttribute("role","alert"),u.setAttribute("aria-live","assertive"),u.textContent=`Missing extension permissions (${p.join(", ")}). Grant all permissions in Extension Manager so actions and dropdowns work properly.`,i.append(u)}let h=[],g=[];if(n.permissions.interceptor===!1)h.push("interceptor"),g.push("preset-aware guidance placement (pre-history, in-history, before/after post-history) and swipe turn matching fall back to basic heuristic placement");if(n.permissions.regex_scripts===!1)h.push("regex_scripts"),g.push("Lumiverse regex scripts are skipped on guidance prompts and generated/impersonated outputs");if(h.length>0){let u=document.createElement("div");u.className="gg-notice is-warn",u.setAttribute("role","alert"),u.setAttribute("aria-live","assertive"),u.textContent=`Optional permissions not granted (${h.join(", ")}): ${g.join("; ")}. Grant them in Extension Manager for full functionality.`,i.append(u)}if(n.catalogWarnings&&n.catalogWarnings.length>0){let u=document.createElement("div");u.className="gg-notice is-warn",u.setAttribute("role","alert"),u.setAttribute("aria-live","assertive"),u.textContent=n.catalogWarnings.join(" "),i.append(u)}let a=Ht(n.connections),m=Nt(n.presets),x=[{value:"system",label:"System"},{value:"user",label:"User"},{value:"assistant",label:"Assistant"}];this.renderToolbarLayoutSection(i,n.settings);for(let u of we)this.renderActionSection(i,n.settings,u,n.connections,a,m,x);this.renderRecoverySection(i,n.settings,n.recovery),this.restoreCapturedFocus(i)}restoreCapturedFocus(e){if(this.pendingFocusRestore){let t=this.pendingFocusRestore;this.pendingFocusRestore=null,this.pendingGeneralFocusRestore=null;let n=e.querySelector(`[data-gg-order-id="${t.optionId}"]`),i=n?.querySelector(`button[data-gg-move="${t.button}"]`),r=n?.querySelector(`button[data-gg-move="${t.button==="up"?"down":"up"}"]`);(i&&!i.disabled?i:r&&!r.disabled?r:null)?.focus();return}if(this.pendingGeneralFocusRestore){let t=this.pendingGeneralFocusRestore;this.pendingGeneralFocusRestore=null;let n=null;if(t.focusKey)n=ut(e,"data-gg-focus-key",t.focusKey);if(!n&&t.ariaLabel)n=ut(e,"aria-label",t.ariaLabel,t.tagName);if(n&&!n.disabled)n.focus()}}createCollapsibleCard(e,t,n,i,r=!1,s){let l=document.createElement("section");if(l.className="gg-card",this.expandedSections.has(t))l.classList.add("is-expanded");let d=document.createElement("button");d.type="button",d.className="gg-card-header",d.dataset.ggFocusKey=`card-header:${t}`,d.setAttribute("aria-expanded",String(this.expandedSections.has(t)));let o=document.createElement("span");o.className="gg-card-header-left";let p=document.createElement("span");p.className="gg-card-chevron",p.setAttribute("aria-hidden","true"),p.textContent="▸";let h=document.createElement("span");h.textContent=n,o.append(p,h);let g=document.createElement("span");if(g.className=`gg-card-badge${r?" is-muted":""}`,i!==void 0)g.textContent=i;else g.style.display="none";d.append(o,g);let a=document.createElement("div");a.className="gg-card-body-wrap";let m=`gg-card-body-${t}`;a.id=m,d.setAttribute("aria-controls",m);let x=document.createElement("div");return x.className="gg-section-body",a.append(x),d.addEventListener("click",()=>{let u=!l.classList.contains("is-expanded");if(l.classList.toggle("is-expanded",u),d.setAttribute("aria-expanded",String(u)),u)this.expandedSections.add(t);else this.expandedSections.delete(t);s?.(u)}),l.append(d,a),e.append(l),{body:x,setBadge(u,T=!1){g.textContent=u,g.className=`gg-card-badge${T?" is-muted":""}`,g.style.display=u?"":"none"}}}renderToolbarLayoutSection(e,t){let n=ve(t.toolbarPlacement),i=me.find((u)=>u.value===n)??me[0],r=this.createCollapsibleCard(e,"toolbar_layout","Toolbar Position & Order",i.shortLabel,!1),s=r.body,l=document.createElement("p");l.className="gg-muted",l.textContent="Choose where the Guided Generations buttons appear on the composer bar and customize their left-to-right order.",s.append(l);let d=(u,T)=>{let E={...this.currentSettings??t,...u};if(this.currentSettings=E,u.toolbarPlacement!==void 0){let b=me.find((_)=>_.value===u.toolbarPlacement);if(b)r.setBadge(b.shortLabel,!1)}this.handlers.onSaveSettings(E,T)},o=te("Bar Placement");s.append(o.wrap),this.handles.push(this.ctx.components.mountSelect(o.slot,{options:me.map((u)=>({value:u.value,label:u.label,sublabel:u.sublabel})),value:n,ariaLabel:"Toolbar Bar Placement",onChange:(u)=>{d({toolbarPlacement:ve(u)},{rebuildDrawer:!1})}}));let p=te("Button Order (left to right)"),h=document.createElement("div");h.className="gg-order-list";let g=Ie(t.buttonOrder);g.forEach((u,T)=>{let R=document.createElement("div");R.className="gg-order-item",R.setAttribute("data-gg-order-id",u);let E=document.createElement("div");E.className="gg-order-item-left";let b=document.createElement("span");b.className="gg-order-item-icon",b.setAttribute("aria-hidden","true"),b.innerHTML=be[u];let _=u==="input_recovery"?"Input Recovery":de[u].label,N=u==="input_recovery"?t.inputRecovery.enabled:Boolean(t.actions[u]?.enabled),k=document.createElement("span");k.className="gg-order-item-label",k.textContent=_;let L=document.createElement("span");L.className="gg-order-item-state",L.textContent=N?"Visible":"Hidden",this.orderStateTags.set(u,L),E.append(b,k,L);let y=document.createElement("div");y.className="gg-order-item-controls";let C=(P)=>{let A=T+P;if(A<0||A>=g.length)return;this.flushPendingSaves();let Y=[...g],[X]=Y.splice(T,1);if(!X)return;Y.splice(A,0,X);let F=P===-1?A===0?"down":"up":A===Y.length-1?"up":"down";this.pendingFocusRestore={optionId:X,button:F},d({buttonOrder:Y},{rebuildDrawer:!0})},I=document.createElement("button");I.type="button",I.className="gg-icon-btn-sm",I.dataset.ggMove="up",I.textContent="↑",I.title=`Move ${_} left / up`,I.setAttribute("aria-label",`Move ${_} up`),I.disabled=T===0,I.addEventListener("click",()=>C(-1));let S=document.createElement("button");S.type="button",S.className="gg-icon-btn-sm",S.dataset.ggMove="down",S.textContent="↓",S.title=`Move ${_} right / down`,S.setAttribute("aria-label",`Move ${_} down`),S.disabled=T===g.length-1,S.addEventListener("click",()=>C(1)),y.append(I,S),R.append(E,y),h.append(R)});let a=document.createElement("div");a.className="gg-row";let m=document.createElement("span");m.className="gg-muted",m.textContent="Restore default button order & alignment";let x=document.createElement("button");x.type="button",x.className="gg-btn-sm",x.dataset.ggFocusKey="reset-layout",x.textContent="Reset layout",x.addEventListener("click",()=>{this.flushPendingSaves(),d({toolbarPlacement:"after_native",buttonOrder:[...ke]},{rebuildDrawer:!0})}),a.append(m,x),p.slot.append(h),s.append(p.wrap,a)}renderActionSection(e,t,n,i,r,s,l){let d=de[n],o=t.actions[n],p=o.connectionId,h=this.expandedSections.has(n),g=null,a=this.createCollapsibleCard(e,n,d.label,o.enabled?"Visible":"Hidden",!o.enabled,(M)=>{if(M&&!h)h=!0,g?.update({connection:Ge(p)})}),m=a.body,x=document.createElement("p");x.className="gg-muted",x.textContent=d.description,m.append(x);let u=(M,G={rebuildDrawer:!1})=>{let se=this.currentSettings??t,Z={...se,actions:{...se.actions,[n]:{...se.actions[n],...M}}};if(this.currentSettings=Z,M.enabled!==void 0)a.setBadge(M.enabled?"Visible":"Hidden",!M.enabled),this.updateOrderStateTag(n,M.enabled);this.handlers.onSaveSettings(Z,G)},T=document.createElement("div");T.className="gg-row";let R=document.createElement("span");R.className="gg-field-label",R.textContent="Show button on input bar";let E=document.createElement("div");T.append(R,E),m.append(T),this.handles.push(this.ctx.components.mountSwitch(E,{checked:o.enabled,size:"sm",ariaLabel:`Show ${d.label} button on input bar`,onChange:(M)=>u({enabled:M},{rebuildDrawer:!1})}));let b=document.createElement("div");b.className="gg-row";let _=document.createElement("span");_.className="gg-field-label",_.textContent="Clear input bar when triggered";let N=document.createElement("div");b.append(_,N),m.append(b),this.handles.push(this.ctx.components.mountSwitch(N,{checked:o.clearInputOnRun,size:"sm",ariaLabel:`Clear input bar when running ${d.label}`,onChange:(M)=>u({clearInputOnRun:M})}));let k=document.createElement("div");k.className="gg-row";let L=document.createElement("span");L.className="gg-field-label",L.textContent="Apply Lumiverse regex scripts";let y=document.createElement("div");k.append(L,y),m.append(k),this.handles.push(this.ctx.components.mountSwitch(y,{checked:o.applyRegex??Qe,size:"sm",ariaLabel:`Apply Lumiverse regex scripts for ${d.label}`,onChange:(M)=>u({applyRegex:M})}));let C=kt(this.ctx),I=te("API Connection Profile");m.append(I.wrap),this.handles.push(this.ctx.components.mountSelect(I.slot,{options:r,value:o.connectionId??"",ariaLabel:`${d.label} API Connection Profile`,onChange:(M)=>{let G=M||null;p=G,u({connectionId:G}),g?.update(h?{connection:Ge(G),placeholder:Be(G,i,C)}:{placeholder:Be(G,i,C)})}}));let S=`gg-${n}-model`,P=te("Model (blank = connection profile model)",S);if(m.append(P.wrap),typeof this.ctx.components.mountModelCombobox==="function")g=this.ctx.components.mountModelCombobox(P.slot,{value:o.model??"",connection:h?Ge(p):void 0,appearance:"standard",autoRefreshOnFocus:!0,placeholder:Be(p,i,C),onChange:(M)=>{this.scheduleDebouncedSave(`${n}:model`,()=>{u({model:M.trim()||null})})}}),this.attachSlotInputAttributes(P.slot,S,`${d.label} Model`),this.handles.push(g);let A=te("Preset");m.append(A.wrap),this.handles.push(this.ctx.components.mountSelect(A.slot,{options:s,value:o.presetId??"",ariaLabel:`${d.label} Preset`,onChange:(M)=>u({presetId:M||null})}));let Y=te("Guidance Injection Role");m.append(Y.wrap),this.handles.push(this.ctx.components.mountSelect(Y.slot,{options:l,value:o.injectionRole,ariaLabel:`${d.label} Guidance Injection Role`,onChange:(M)=>u({injectionRole:M})}));let X=Le(o.guidancePosition),F=tt(o.guidanceDepth),K=null,j=`gg-${n}-guidance-depth`,q=te("In-History Depth (0–999)",j),ne=(M)=>{let G=M==="in_history";q.wrap.style.display=G?"":"none",K?.setDisabled(!G)},Q=te("Guidance Position");m.append(Q.wrap,q.wrap),this.handles.push(this.ctx.components.mountSelect(Q.slot,{options:et.map((M)=>({value:M.value,label:M.label,sublabel:M.sublabel})),value:X,ariaLabel:`${d.label} Guidance Position`,onChange:(M)=>{let G=Le(M);u({guidancePosition:G}),ne(G)}})),K=this.mountBoundedIntegerField({slot:q.slot,fieldId:j,ariaLabel:`${d.label} In-history depth`,debounceKey:`${n}:depth`,min:0,max:999,defaultValue:Je,placeholder:"0",initialValue:F,disabled:X!=="in_history",onCommit:(M)=>{u({guidanceDepth:M})}}),ne(X);let O=te("Guidance Template (supports {{input}} and Lumiverse macros like {{char}}, {{user}}; leave blank for raw input)");m.append(O.wrap),this.handles.push(this.ctx.components.mountTextArea(O.slot,{value:o.instructionTemplate,rows:2,placeholder:"{{input}}",ariaLabel:`${d.label} Guidance Template`,onChange:(M)=>{this.scheduleDebouncedSave(`${n}:template`,()=>{u({instructionTemplate:M})})}}))}mountBoundedIntegerField(e){let t=(o)=>{if(typeof o==="number"&&Number.isFinite(o))return Math.max(e.min,Math.min(e.max,Math.floor(o)));return Math.max(e.min,Math.min(e.max,Math.floor(e.defaultValue)))},n=t(e.initialValue),i=!1,r=!1,s=null,l=null,d=(o)=>{if(r)return;if(o===null){i=!0,this.cancelPendingSaveKey(e.debounceKey);return}i=!1;let p=t(o);n=p,this.scheduleDebouncedSave(e.debounceKey,()=>{e.onCommit(p)})};if(typeof this.ctx.components.mountNumericInput==="function")s=this.ctx.components.mountNumericInput(e.slot,{value:n,min:e.min,max:e.max,step:1,integer:!0,allowEmpty:!0,placeholder:e.placeholder,disabled:Boolean(e.disabled),ariaLabel:e.ariaLabel,onChange:d}),this.attachSlotInputAttributes(e.slot,e.fieldId,e.ariaLabel),e.slot.addEventListener("focusout",(o)=>{let p=o.relatedTarget;if(p&&e.slot.contains(p))return;if(i||s?.getValue()===null){i=!1;let h=t(e.defaultValue);if(h!==n)n=h,e.onCommit(h)}else this.flushPendingSaveKey(e.debounceKey);if(s&&s.getValue()!==n){r=!0;try{s.update({value:n})}finally{r=!1}}}),this.handles.push(s);else{let o=document.createElement("input");o.type="number",o.id=e.fieldId,o.className="gg-input-sm",o.min=String(e.min),o.max=String(e.max),o.step="1",o.placeholder=e.placeholder,o.value=String(n),o.disabled=Boolean(e.disabled),o.setAttribute("aria-label",e.ariaLabel),o.addEventListener("input",()=>{let p=o.value.trim(),h=p===""?null:Number(p);d(h!==null&&Number.isFinite(h)?h:null)}),o.addEventListener("blur",()=>{if(i||o.value.trim()===""){i=!1;let p=t(e.defaultValue);if(p!==n)n=p,e.onCommit(p)}else this.flushPendingSaveKey(e.debounceKey);o.value=String(n)}),l=o,e.slot.append(o)}return{setDisabled:(o)=>{if(s){r=!0;try{s.update({disabled:o})}finally{r=!1}}if(l)l.disabled=o}}}updateOrderStateTag(e,t){let n=this.orderStateTags.get(e);if(n)n.textContent=t?"Visible":"Hidden"}renderRecoverySection(e,t,n){let i=this.createCollapsibleCard(e,"input_recovery","Input Recovery",n.length>0?String(n.length):void 0,n.length===0),r=i.body,s=document.createElement("p");s.className="gg-muted",s.textContent="Automatically saves composer input cleared or replaced by guided actions so you can restore it in one click. When no saved inputs exist, clicking Input Recovery clears the current input.",r.append(s);let l=document.createElement("div");l.className="gg-row";let d=document.createElement("span");d.className="gg-field-label",d.textContent="Enable Input Recovery & toolbar button";let o=document.createElement("div");l.append(d,o),r.append(l),this.handles.push(this.ctx.components.mountSwitch(o,{checked:t.inputRecovery.enabled,size:"sm",ariaLabel:"Show Input Recovery button on input bar",onChange:(x)=>{let u=this.currentSettings??t,T={...u,inputRecovery:{...u.inputRecovery,enabled:x}};this.currentSettings=T,this.updateOrderStateTag("input_recovery",x),this.handlers.onSaveSettings(T,{rebuildDrawer:!1})}}));let p="gg-recovery-max-entries",h=te("Max saved drafts (1–50)",p);r.append(h.wrap),this.mountBoundedIntegerField({slot:h.slot,fieldId:p,ariaLabel:"Max saved drafts",debounceKey:"recovery:maxEntries",min:1,max:50,defaultValue:10,placeholder:"10",initialValue:t.inputRecovery.maxEntries,onCommit:(x)=>{let u=this.currentSettings??t,T={...u,inputRecovery:{...u.inputRecovery,maxEntries:x}};if(this.currentSettings=T,this.recoveryUi)this.recoveryUi.maxEntries=x,this.recoveryUi.countLabel.textContent=this.recoveryUi.recoveryCount>0?`Saved inputs (${this.recoveryUi.recoveryCount}/${x}):`:"No saved inputs yet.";this.handlers.onSaveSettings(T,{rebuildDrawer:!1})}});let g=document.createElement("div");g.className="gg-row";let a=document.createElement("span");a.className="gg-muted",a.textContent=n.length>0?`Saved inputs (${n.length}/${t.inputRecovery.maxEntries}):`:"No saved inputs yet.";let m=document.createElement("button");m.type="button",m.className="gg-btn-sm",m.dataset.ggFocusKey="clear-recovery",m.textContent="Clear History",m.disabled=this.recoveryBusy||n.length===0,m.addEventListener("click",()=>{this.handlers.onClearRecovery()}),g.append(a,m),r.append(g),this.recoveryUi={setBadge:i.setBadge,countLabel:a,clearBtn:m,body:r,listEl:null,maxEntries:t.inputRecovery.maxEntries,recoveryCount:n.length},this.syncRecoveryList(n)}syncRecoveryList(e){if(!this.recoveryUi)return;if(this.recoveryUi.listEl)this.recoveryUi.listEl.remove(),this.recoveryUi.listEl=null;if(e.length===0)return;let t=document.createElement("div");t.className="gg-recovery-list";for(let n of e){let i=document.createElement("div");i.className="gg-recovery-item";let r=document.createElement("div");r.className="gg-recovery-meta";let s=de[n.actionId]?.label??n.actionId,l=document.createElement("span");l.className="gg-recovery-tag",l.textContent=s;let d=document.createElement("span");d.className="gg-recovery-snippet",d.textContent=pe(n.text),d.title=n.text,r.append(l,d);let o=document.createElement("button");o.type="button",o.className="gg-btn-sm",o.textContent="Restore",o.disabled=this.recoveryBusy,o.setAttribute("aria-label",`Restore ${s} draft: ${pe(n.text,40)}`),o.addEventListener("click",()=>this.handlers.onRestoreEntry(n)),i.append(r,o),t.append(i)}this.recoveryUi.listEl=t,this.recoveryUi.body.append(t)}attachSlotInputAttributes(e,t,n){let i=()=>{let s=e.querySelector("input");if(!s)return!1;if(!s.id)s.id=t;if(!s.getAttribute("aria-label"))s.setAttribute("aria-label",n);return!0};if(i()||typeof MutationObserver!=="function")return;let r=new MutationObserver(()=>{if(i())r.disconnect()});r.observe(e,{childList:!0,subtree:!0}),this.handles.push({destroy:()=>r.disconnect()})}scheduleDebouncedSave(e,t,n=250){let i=this.debounceTimers.get(e);if(i)clearTimeout(i.timer);let r=()=>{if(this.destroyed)return;t()},s=setTimeout(()=>{this.debounceTimers.delete(e),r(),this.flushPendingViewIfIdle()},n);this.debounceTimers.set(e,{timer:s,flush:r})}flushPendingSaves(){if(this.destroyed||this.debounceTimers.size===0)return;let e=Array.from(this.debounceTimers.entries());this.debounceTimers.clear();for(let[,t]of e)clearTimeout(t.timer),t.flush()}flushPendingSaveKey(e){if(this.destroyed)return;let t=this.debounceTimers.get(e);if(!t)return;this.debounceTimers.delete(e),clearTimeout(t.timer),t.flush()}cancelPendingSaveKey(e){let t=this.debounceTimers.get(e);if(!t)return;this.debounceTimers.delete(e),clearTimeout(t.timer)}cancelPendingSaves(){for(let e of this.debounceTimers.values())clearTimeout(e.timer);this.debounceTimers.clear()}clearComponentHandles(){for(let e of this.handles)e.destroy();this.handles=[]}destroy(){if(this.flushPendingSaves(),this.destroyed=!0,this.pendingView=null,this.pendingFocusRestore=null,this.pendingGeneralFocusRestore=null,this.pointerActiveInDrawer=!1,this.pointerFallbackTimer!==null)clearTimeout(this.pointerFallbackTimer),this.pointerFallbackTimer=null;if(this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer),this.pendingViewFlushTimer=null;if(this.pointerReleaseCleanup){let e=this.pointerReleaseCleanup;this.pointerReleaseCleanup=null,e()}for(let e of[...this.tabConnectionCleanups])e();this.tabConnectionCleanups.clear(),this.rootEl=null,this.headerEl=null,this.noticeEl=null,this.recoveryUi=null,this.orderStateTags.clear(),this.tab.root.removeEventListener("pointerdown",this.onPointerDownInDrawer),this.tab.root.removeEventListener("mousedown",this.onPointerDownInDrawer),this.tab.root.removeEventListener("focusout",this.onFocusOut),this.cancelPendingSaves(),this.clearComponentHandles(),this.tab.root.replaceChildren(),this.tab.destroy()}}function Re(e){return Boolean(e&&typeof e==="object"&&e.nodeType===1)}function ct(e){let t=e.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||e.isContentEditable}function Lt(e,t){if(!Re(t)||!e.contains(t))return!1;return Boolean(t.closest('button, [role="button"], [role="switch"], [role="menuitem"], [role="option"], summary, a[href]'))}function ut(e,t,n,i){let r=i?i.toLowerCase():"*";for(let s of e.querySelectorAll(r))if(s.getAttribute(t)===n)return s;return null}function kt(e){return e.connections?.getActive?.()?.activeProfileId??null}function Ge(e){return e?{kind:"llm",id:e}:{kind:"llm"}}function Be(e,t,n){let r=(e?t.find((s)=>s.id===e):(n?t.find((s)=>s.id===n):void 0)??t.find((s)=>s.isDefault)??t[0])?.model?.trim();return r?`Use connection model (${r})`:"Leave blank for connection model"}var Dt=0;function te(e,t){let n=document.createElement("div");n.className="gg-field";let i=document.createElement("label");if(i.className="gg-field-label",i.id=`gg-field-label-${++Dt}`,t)i.htmlFor=t;i.textContent=e;let r=document.createElement("div");return n.append(i,r),{wrap:n,slot:r,label:i}}function Ht(e){return[{value:"",label:"Use Active Connection",sublabel:"Inherits whichever connection profile is currently active"},...e.map((t)=>({value:t.id,label:t.name,sublabel:t.model?`${t.provider} · ${t.model}`:t.provider}))]}function Nt(e){return[{value:"",label:"Use Active Preset",sublabel:"Inherits the active chat or connection preset"},...e.map((t)=>({value:t.id,label:t.name}))]}var Ft=new Set(["guided_response","guided_regenerate","guided_swipe","guided_continue"]);function pt(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}class Ue{ctx;disposers=[];runStateById=new Map;currentRun=null;viewedSwipeId=void 0;swipeInitialized=!1;contentSeen=!1;mountedEl=null;mountedTarget=null;mountedPosition=null;rafId=null;rafTimerId=null;rafRetries=0;retryMode=null;destroyed=!1;constructor(e){this.ctx=e;if(typeof this.ctx.events?.on==="function"){let t=()=>{if(!this.destroyed)this.rafRetries=0,this.syncCurrent()};this.disposers.push(this.ctx.events.on("MESSAGE_SWIPED",(n)=>{this.onMessageEvent(n,"MESSAGE_SWIPED")}),this.ctx.events.on("MESSAGE_EDITED",(n)=>{this.onMessageEvent(n,"MESSAGE_EDITED")}),this.ctx.events.on("MESSAGE_SENT",(n)=>{this.onMessageEvent(n,"MESSAGE_SENT")}),this.ctx.events.on("CHAT_CHANGED",t),this.ctx.events.on("CHAT_SWITCHED",t))}}sync(e){if(this.destroyed)return;let t=this.currentRun;if(t)this.saveRunState(t.runId);let n=t?.runId!==e?.runId||t?.messageId!==e?.messageId||t?.actionId!==e?.actionId;if(t?.runId!==e?.runId){let i=e?this.runStateById.get(e.runId):void 0;if(i)this.contentSeen=i.contentSeen,this.viewedSwipeId=i.viewedSwipeId,this.swipeInitialized=i.swipeInitialized;else this.contentSeen=!1,this.viewedSwipeId=void 0,this.swipeInitialized=!1;this.resetRetry()}else if(t?.messageId!==e?.messageId)this.resetRetry();if(this.currentRun=e,e&&!this.swipeInitialized&&e.swipeId!==void 0)this.viewedSwipeId=e.backgroundSwipe?void 0:e.swipeId,this.swipeInitialized=!0;if(e)this.saveRunState(e.runId);if(n)this.unmount();this.syncCurrent()}destroy(){if(this.destroyed)return;this.destroyed=!0,this.resetRetry(),this.unmount(),this.currentRun=null,this.runStateById.clear();for(let e of this.disposers)try{e()}catch{}this.disposers.length=0}saveRunState(e){if(!e)return;if(this.runStateById.has(e))this.runStateById.delete(e);if(this.runStateById.set(e,{viewedSwipeId:this.viewedSwipeId,swipeInitialized:this.swipeInitialized,contentSeen:this.contentSeen}),this.runStateById.size>32){let t=this.runStateById.keys().next().value;if(t!==void 0)this.runStateById.delete(t)}}onMessageEvent(e,t){if(this.destroyed||!this.currentRun?.messageId)return;let n=pt(e)?e:null,i=n&&pt(n.message)?n.message:null,r=typeof i?.id==="string"?i.id:typeof n?.messageId==="string"?n.messageId:void 0;if(r!==void 0&&r!==this.currentRun.messageId)return;if(r===this.currentRun.messageId){let s=typeof i?.swipe_id==="number"?i.swipe_id:typeof n?.swipeId==="number"?n.swipeId:void 0;if(s!==void 0)this.viewedSwipeId=s,this.swipeInitialized=!0;if(typeof i?.content==="string"&&i.content.length>0&&(this.currentRun.swipeId==null||this.viewedSwipeId===this.currentRun.swipeId||this.viewedSwipeId===void 0))this.contentSeen=!0;if(this.saveRunState(this.currentRun.runId),t==="MESSAGE_SWIPED"||this.retryMode==="content")this.rafRetries=0}this.syncCurrent()}syncCurrent(){if(this.destroyed)return;let e=this.currentRun;if(!this.shouldDisplay(e)){this.resetRetry(),this.unmount();return}if(typeof this.ctx.dom?.findMessageElement!=="function"||typeof this.ctx.dom?.inject!=="function")return;let t=this.resolveTarget(e.messageId,e.actionId);if(!t){this.unmount(),this.ensureRetryMode("row"),this.scheduleRetry();return}let n=Boolean(e.hasContentOutput||this.contentSeen);if(this.mountedEl&&this.mountedTarget===t.element&&this.mountedPosition===t.position&&this.isMountedAt(this.mountedEl,t.element,t.position)){if(!t.isMessageContent&&n)this.ensureRetryMode("content"),this.scheduleRetry();else this.resetRetry();return}this.unmount();let i=t.isMessageContent?'<div class="gg-streaming-indicator gg-streaming-indicator--after" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>':'<div class="gg-streaming-indicator" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';if(this.mountedEl=this.ctx.dom.inject(t.element,i,t.position),this.mountedTarget=t.element,this.mountedPosition=t.position,!t.isMessageContent&&n)this.ensureRetryMode("content"),this.scheduleRetry();else this.resetRetry()}shouldDisplay(e){if(!e||this.destroyed)return!1;if(!Ft.has(e.actionId))return!1;if(typeof e.messageId!=="string"||e.messageId.length===0)return!1;let t=this.safeGetActiveChatId();if(!t||e.chatId!==t)return!1;if(e.actionId==="guided_swipe"){if(typeof e.swipeId!=="number"||this.viewedSwipeId!==e.swipeId)return!1}else if(e.swipeId!=null&&this.viewedSwipeId!==e.swipeId)return!1;return!0}safeGetActiveChatId(){try{return this.ctx.getActiveChat?.().chatId??null}catch{return null}}isMountedAt(e,t,n){if(n==="afterend")return t.parentNode!==null&&t.nextElementSibling===e;if(n==="beforebegin")return t.parentNode!==null&&t.previousElementSibling===e;return t.contains(e)}resolveTarget(e,t){if(typeof this.ctx.dom?.findMessageElement!=="function")return null;let n=this.ctx.dom.findMessageElement(e);if(!n)return null;let i=n.querySelector('[data-component="MessageContent"]');if(i)return{element:i,position:"afterend",isMessageContent:!0};if(t==="guided_continue")return this.resolveContinueFallbackTarget(n);let r=n.querySelector('[data-spindle-mount="message_body_before"]');if(r)return{element:r,position:"beforeend",isMessageContent:!1};let s=n.querySelector('[data-spindle-mount="message_body_after"]');if(s)return{element:s,position:"beforeend",isMessageContent:!1};let l=n.querySelector('[data-component="BubbleMessage"] > div > div:last-child');if(l)return{element:l,position:"beforeend",isMessageContent:!1};if(typeof n.matches==="function"&&n.matches('[data-component="BubbleMessage"]')){let o=n.firstElementChild?.lastElementChild;return o?{element:o,position:"beforeend",isMessageContent:!1}:null}let d=n.querySelector('[data-component="MinimalMessage"] > div');if(d)return{element:d,position:"beforeend",isMessageContent:!1};if(typeof n.matches==="function"&&n.matches('[data-component="MinimalMessage"]')){let o=n.firstElementChild;return o?{element:o,position:"beforeend",isMessageContent:!1}:null}return null}resolveContinueFallbackTarget(e){let t=e.querySelector('[data-spindle-mount="message_body_after"]');if(t)return{element:t,position:"beforeend",isMessageContent:!1};let n=e.querySelector('[data-spindle-mount="message_body_before"]');if(n)return{element:n,position:"beforeend",isMessageContent:!1};let i=e.querySelector('[data-component="BubbleMessage"] [class*="content"]');if(i)return{element:i,position:"beforeend",isMessageContent:!1};if(typeof e.matches==="function"&&e.matches('[data-component="BubbleMessage"]')){let l=e.querySelector('[class*="content"]')??e.firstElementChild?.lastElementChild;if(l)return{element:l,position:"beforeend",isMessageContent:!1}}let r=e.querySelector('[data-component="BubbleMessage"] > div > div:last-child');if(r)return{element:r,position:"beforeend",isMessageContent:!1};let s=e.querySelector('[data-component="MinimalMessage"] > div');if(s)return{element:s,position:"beforeend",isMessageContent:!1};if(typeof e.matches==="function"&&e.matches('[data-component="MinimalMessage"]')&&e.firstElementChild)return{element:e.firstElementChild,position:"beforeend",isMessageContent:!1};return{element:e,position:"beforeend",isMessageContent:!1}}ensureRetryMode(e){if(this.retryMode!==e)this.cancelRetry(),this.rafRetries=0,this.retryMode=e}resetRetry(){this.cancelRetry(),this.rafRetries=0,this.retryMode=null}unmount(){let e=this.mountedEl;if(this.mountedEl=null,this.mountedTarget=null,this.mountedPosition=null,!e)return;try{if(typeof this.ctx.dom?.uninject==="function")this.ctx.dom.uninject(e);else e.remove()}catch{}}scheduleRetry(){if(this.destroyed||this.rafId!==null||this.rafTimerId!==null)return;if(this.rafRetries>=30)return;this.rafRetries+=1;let e=typeof globalThis.requestAnimationFrame==="function"?globalThis.requestAnimationFrame.bind(globalThis):void 0;if(e)this.rafId=e(()=>{if(this.rafId=null,!this.destroyed)this.syncCurrent()});else this.rafTimerId=setTimeout(()=>{if(this.rafTimerId=null,!this.destroyed)this.syncCurrent()},16)}cancelRetry(){if(this.rafId!==null){if(typeof globalThis.cancelAnimationFrame==="function")globalThis.cancelAnimationFrame(this.rafId);this.rafId=null}if(this.rafTimerId!==null)clearTimeout(this.rafTimerId),this.rafTimerId=null}}var ht=`
.gg-actions-host {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 0;
}

.gg-actions-host.is-before-native {
  order: -1;
}

.gg-actions-host.is-right {
  margin-left: auto;
}

.gg-actions-host--row {
  display: flex;
  align-items: center;
  max-width: 100%;
  flex-wrap: wrap;
}

.gg-actions-host .gg-toolbar,
.gg-actions-host--row .gg-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  flex-wrap: nowrap;
}

.gg-actions-host--row .gg-toolbar {
  flex-wrap: wrap;
}

.gg-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text-dim, rgba(230, 230, 240, 0.45));
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
  transition:
    color var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
    background var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
    transform 90ms ease;
}

.gg-btn:hover:not(:disabled) {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, rgba(230, 230, 240, 0.92));
}

.gg-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.gg-btn.is-holding {
  background: rgba(139, 92, 246, 0.22);
  color: var(--lumiverse-primary, #c4b5fd);
  box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.35);
  transform: scale(0.92);
}

.gg-btn.is-running {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
  box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.35);
}

.gg-btn.is-running::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 2px solid rgba(248, 113, 113, 0.45);
  pointer-events: none;
  will-change: transform, opacity;
  animation: gg-pulse 1.3s ease-in-out infinite;
}

.gg-btn.is-dimmed,
.gg-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.gg-btn svg {
  width: 14px;
  height: 14px;
  pointer-events: none;
  display: block;
}

@media (max-width: 768px) {
  .gg-btn {
    width: 28px;
  }
}

@keyframes gg-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.75;
  }
  50% {
    transform: scale(1.22);
    opacity: 0;
  }
}

/* Settings Drawer */
.gg-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  font-size: 13px;
}

.gg-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.gg-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.gg-muted {
  margin: 4px 0 0;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.68)));
  font-size: 12px;
  line-height: 1.4;
}

.gg-notice {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(59, 130, 246, 0.38);
  background: rgba(59, 130, 246, 0.12);
  font-size: 12px;
  line-height: 1.4;
}

.gg-notice.is-error {
  border-color: rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
}

.gg-notice.is-warn {
  border-color: rgba(245, 158, 11, 0.48);
  background: rgba(245, 158, 11, 0.14);
  color: #fde68a;
}

.gg-section-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
}

.gg-card {
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
  overflow: visible;
}

.gg-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  border-radius: 10px;
}

.gg-card-header:hover {
  background: var(--lumiverse-fill-hover, rgba(255, 255, 255, 0.06));
}

.gg-card-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.gg-card-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  transition: transform 140ms ease;
  opacity: 0.72;
}

.gg-card.is-expanded .gg-card-chevron {
  transform: rotate(90deg);
}

.gg-card-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.16);
  color: var(--lumiverse-primary, #c4b5fd);
}

.gg-card-badge.is-muted {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.65)));
}

.gg-card-body-wrap {
  border-top: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
}

.gg-card:not(.is-expanded) .gg-card-body-wrap {
  display: none;
}

.gg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.gg-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gg-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--lumiverse-text, var(--text-secondary, rgba(229, 231, 235, 0.85)));
}

.gg-btn-sm {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.16)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.08)));
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.gg-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, var(--surface-hover, rgba(255, 255, 255, 0.15)));
}

.gg-btn-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-input-sm {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.16)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.06)));
  color: inherit;
  font: inherit;
  font-size: 12.5px;
}

.gg-input-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-recovery-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-recovery-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  background: var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.16));
}

.gg-recovery-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.gg-recovery-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
}

.gg-recovery-snippet {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gg-order-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  background: var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.16));
}

.gg-order-item-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.gg-order-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.78)));
}

.gg-order-item-icon svg {
  width: 14px;
  height: 14px;
  display: block;
}

.gg-order-item-label {
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-item-state {
  font-size: 10.5px;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.55)));
}

.gg-order-item-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.gg-icon-btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.14)));
  background: var(--lumiverse-fill, var(--surface-elevated, rgba(255, 255, 255, 0.06)));
  color: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.gg-icon-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, var(--surface-hover, rgba(255, 255, 255, 0.14)));
}

.gg-icon-btn-sm:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Guided Continue Drop-Up Menu (portaled to document.body) */
.gg-dropup-menu {
  position: fixed;
  z-index: 11000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 210px;
  max-width: calc((100vw - 16px) / var(--lumiverse-ui-scale, 1));
  padding: 4px;
  border-radius: var(--lcs-radius-md, 10px);
  border: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.14)));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
}

.gg-dropup-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.gg-dropup-item:hover {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
}

.gg-dropup-item:focus-visible {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
  outline: 2px solid var(--lumiverse-primary, var(--accent-primary, #8b5cf6));
  outline-offset: -2px;
}

.gg-dropup-item svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  pointer-events: none;
  display: block;
  color: var(--lumiverse-primary, var(--accent-primary, currentColor));
}

.gg-dropup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px 6px;
  border-bottom: 1px solid var(--lumiverse-border, var(--border-color, rgba(255, 255, 255, 0.1)));
  margin-bottom: 2px;
}

.gg-dropup-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.75)));
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}

.gg-dropup-back:hover {
  background: var(--lumiverse-fill, var(--bg-hover, rgba(255, 255, 255, 0.08)));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
}

.gg-dropup-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
  padding-right: 4px;
}

.gg-dropup-history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-dropup-history-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 220px;
  max-width: 300px;
}

.gg-dropup-history-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.6)));
}

.gg-dropup-history-snippet {
  font-size: 12.5px;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-dropup-empty {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--lumiverse-text-dim, var(--text-secondary, rgba(229, 231, 235, 0.65)));
  text-align: center;
}


/* Streaming Indicator */
.gg-streaming-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.gg-streaming-indicator--after {
  margin-top: 4px;
}

.gg-streaming-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  animation: gg-streaming-bounce 1.2s ease-in-out infinite;
}

.gg-streaming-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.gg-streaming-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes gg-streaming-bounce {
  0%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

/* Floating Chat Heads */
.gg-chat-heads-root {
  position: fixed;
  z-index: 10950;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 6px;
  overflow: visible;
  transform: translate(-50%, -50%);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  cursor: grab;
}

.gg-chat-heads-root.is-dragging {
  cursor: grabbing;
}

.gg-chat-heads-root.is-dragging .gg-chat-head {
  cursor: grabbing;
}

.gg-chat-heads-root.is-dragging .gg-chat-head:active {
  transform: none;
}

.gg-chat-head-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
}

.gg-chat-head-dismiss {
  position: absolute;
  top: -4px;
  left: -4px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.25));
  background: var(--lumiverse-bg-deep, #18181f);
  color: var(--lumiverse-text, #e5e7eb);
  font-size: 11px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
  z-index: 1;
}

.gg-chat-head-item:hover .gg-chat-head-dismiss,
.gg-chat-head-item:focus-within .gg-chat-head-dismiss {
  opacity: 1;
  transform: scale(1);
}

.gg-chat-head-dismiss:hover {
  background: var(--lumiverse-danger, #ef4444);
  border-color: rgba(255, 255, 255, 0.4);
  color: #fff;
}

@media (hover: none), (pointer: coarse) {
  .gg-chat-head-dismiss {
    opacity: 1;
    transform: scale(1);
    width: 22px;
    height: 22px;
    top: -5px;
    left: -5px;
    font-size: 12px;
  }
}

.gg-chat-head {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-border, rgba(255, 255, 255, 0.22));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.45),
    0 2px 6px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  transition:
    transform 140ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.gg-chat-head:hover {
  transform: scale(1.06);
}

.gg-chat-head:active {
  transform: scale(0.96);
}

.gg-chat-head.is-running {
  border-color: var(--lumiverse-warning, #f59e0b);
  box-shadow:
    0 0 0 3px rgba(245, 158, 11, 0.24),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-running::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid rgba(139, 92, 246, 0.45);
  pointer-events: none;
  will-change: transform, opacity;
  animation: gg-chat-head-pulse 1.5s ease-in-out infinite;
}

.gg-chat-head.is-streaming {
  border-color: var(--lumiverse-primary, #8b5cf6);
  box-shadow:
    0 0 0 3px rgba(139, 92, 246, 0.28),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-completed {
  border-color: var(--lumiverse-success, #22c55e);
  box-shadow:
    0 0 0 3px rgba(34, 197, 94, 0.3),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
  -webkit-user-drag: none;
  display: block;
}

.gg-chat-head-initials {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--lumiverse-text, #e5e7eb);
  pointer-events: none;
}

.gg-chat-head-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-bg-deep, #18181f);
  background: var(--lumiverse-warning, #f59e0b);
  pointer-events: none;
}

.gg-chat-head.is-streaming .gg-chat-head-badge {
  background: var(--lumiverse-primary, #8b5cf6);
}

.gg-chat-head.is-completed .gg-chat-head-badge {
  background: var(--lumiverse-success, #22c55e);
}

.gg-chat-head-pip {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-bg-deep, #18181f);
  background: var(--lumiverse-danger, #ef4444);
  pointer-events: none;
}

@keyframes gg-chat-head-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.75;
  }
  50% {
    transform: scale(1.16);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gg-btn,
  .gg-btn.is-running::after,
  .gg-streaming-dot,
  .gg-chat-head,
  .gg-chat-head.is-running::after,
  .gg-chat-head-dismiss,
  .gg-card-chevron,
  .gg-dropup-item {
    animation: none !important;
    transition: none !important;
  }
}
`;function Ae(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function ie(e,t){if(Object.is(e,t))return!0;if(typeof e!==typeof t||e===null||t===null)return!1;if(typeof e!=="object")return!1;if(Array.isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let l=0;l<e.length;l+=1)if(!ie(e[l],t[l]))return!1;return!0}let n=e,i=t,r=Object.keys(n),s=Object.keys(i);if(r.length!==s.length)return!1;for(let l of r){if(!Object.prototype.hasOwnProperty.call(i,l))return!1;if(!ie(n[l],i[l]))return!1}return!0}function ze(e){if(!Ae(e))return null;if(typeof e.chatId==="string"&&e.chatId)return e.chatId;if(Ae(e.chat)&&typeof e.chat.id==="string")return e.chat.id;return null}function Ot(e){let t=ze(e);if(t)return t;if(Ae(e)&&typeof e.id==="string"&&e.id)return e.id;return null}function gt(e,t){if(!Array.isArray(t)||t.length===0)return e;return{...e,connections:t.map((n)=>({id:n.id,name:n.name,provider:n.provider??"",model:n.model??"",isDefault:Boolean(n.is_default)}))}}async function Gt(e,t){if(e.connections.length>0||!t.connections?.list)return e;try{let n=t.connections.list();if(n&&typeof n.then==="function"){let i=await n;return gt(e,i)}return gt(e,n)}catch{return e}}function cn(e){let t=e,n=t.dom.addStyle(ht),i=[],r=!1,s=0,l=0,d=0,o=0,p=0,h=!1,g=new Set,a=null,m=!1,x=!1,u=null,T=null,R=new Map,E=new Map,b=new Map,_=[0,20,50,100,200],N,k=null,L=0,y,C=null;try{C=t.ui.mount("chat_composer_above")}catch{C=null}function I(c){if(!c)return null;return R.get(c)??(T?.chatId===c?T:null)}function S(c){if(!c)return!1;return Boolean(I(c))||g.has(c)}function P(){let c=t.getActiveChat().chatId;if(c&&R.has(c)){T=R.get(c);return}let v=null;for(let f of R.values())if(!v||f.startedAt>=v.startedAt)v=f;T=v}function A(){if(N!==void 0)clearTimeout(N),N=void 0;k=null,L=0}function Y(c){if(r)return;if(k!==c)A(),k=c,L=0;if(N!==void 0)return;let v=_[L];if(v===void 0)return;L+=1,N=setTimeout(()=>{if(N=void 0,r)return;X(c,{fromRetry:!0})},v)}function X(c,v={}){if(r||!c)return;let f=b.get(c);if(f===void 0){if(k===c)A();return}let w=F();if(t.getActiveChat().chatId!==c){if(k===c)A();return}if(!K(w)||w.chatId!==c){if(!v.fromRetry)A();Y(c);return}if(A(),w.text.trim().length>0)return;if(j(f))b.delete(c),q()}function F(){if(r)return null;try{return t.composer?.getState?.()??null}catch{return null}}function K(c){return Boolean(c)&&c.mounted!==!1}function j(c){if(r)return!1;let v=F();if(!K(v))return!1;try{return t.composer.setText(c),!0}catch{return!1}}function q(){if(r)return!1;let c=F();if(!K(c))return!1;try{return t.composer.focus(),!0}catch{return!1}}let ne=new Map;function Q(c,v,f=30000){if(r)return Promise.reject(Error("Extension unloaded."));let w=`gg-${++s}-${Date.now().toString(36)}`;return new Promise((D,H)=>{let B=setTimeout(()=>{ne.delete(w),H(Error(`Timed out waiting for ${c}.`))},f);ne.set(w,{resolve:(U)=>D(U),reject:H,timer:B}),t.sendToBackend({type:"gg:rpc",requestId:w,action:c,input:v})})}function O(c,v="info",f=5000){if(r)return;if(V.setNotice(c,v),y)clearTimeout(y),y=void 0;if(C)if(!c)C.replaceChildren();else{let w=document.createElement("div");if(w.className=`gg-notice${v==="error"?" is-error":v==="warn"?" is-warn":""}`,v==="error"||v==="warn")w.setAttribute("role","alert"),w.setAttribute("aria-live","assertive");else w.setAttribute("role","status"),w.setAttribute("aria-live","polite");w.style.margin="4px 12px",w.textContent=c,C.replaceChildren(w)}if(c&&f>0)y=setTimeout(()=>{if(y=void 0,r)return;V.setNotice("","info"),C?.replaceChildren()},f)}function M(){if(y)clearTimeout(y),y=void 0;if(r)return;V.setNotice("","info"),C?.replaceChildren()}function G(){if(r)return;let{chatId:c}=t.getActiveChat();V.setRecoveryBusy(S(c))}function se(){if(u)u(),u=null}function Z(){if(r||!a)return;let{chatId:c}=t.getActiveChat();We.render({settings:a.settings,activeRun:I(c),recovery:a.recovery,hasActiveChat:Boolean(c),chatId:c}),G()}async function oe(c={}){if(r)return;if(!m&&V.isTabConnected())m=!0,se(),V.render(a);let v=m,f=++l,w=d,D=o;try{let H=await Q("get_bootstrap",{includeCatalogs:v});if(r||f!==l)return;let B=v?await Gt(H,t):H;if(r||f!==l)return;let U=a&&d!==w?a.settings:B.settings,re=new Map,Ee=B.activeRuns;if(Array.isArray(Ee)){for(let z of Ee)if(z&&typeof z.chatId==="string"&&z.chatId.length>0)re.set(z.chatId,z)}if(B.activeRun&&typeof B.activeRun.chatId==="string"&&B.activeRun.chatId.length>0)re.set(B.activeRun.chatId,B.activeRun);if(o===D){R.clear();for(let[z,ce]of re.entries())R.set(z,ce)}else if(p<=D){for(let z of[...R.keys()])if((E.get(z)??0)<=D){let ce=re.get(z);if(ce)R.set(z,ce);else R.delete(z)}for(let[z,ce]of re.entries())if(!R.has(z)&&(E.get(z)??0)<=D)R.set(z,ce)}P();let xe=T,W=a,J={...B,settings:U,activeRun:xe,...!v&&x&&W!==null?{connections:W.connections,presets:W.presets,catalogWarnings:W.catalogWarnings}:{}},Me=v&&!x;if(v)x=!0;let yt=m&&Boolean(c.onlyIfChanged)&&!Me&&W!==null&&ie(W.settings,J.settings)&&ie(W.connections,J.connections)&&ie(W.presets,J.presets)&&ie(W.permissions,J.permissions)&&ie(W.catalogWarnings??[],J.catalogWarnings??[]);a=J,T=xe;let qe=t.getActiveChat().chatId;if(he.sync(I(qe)),ge.syncRuns(R.values(),qe),m){if(!yt)V.render(a);else if(!ie(W.recovery,J.recovery))V.updateRecovery(a.recovery,a.settings)}Z()}catch(H){if(r)return;let B=H instanceof Error?H.message:String(H);O(B,"error")}}async function ft(c,v){if(r||h)return;let f=t.getActiveChat().chatId;if(f&&(I(f)||g.has(f)))return;h=!0;let w=f;if(w)g.add(w),G();try{if(!a)await oe();if(h=!1,r||!a)return;let{chatId:D}=t.getActiveChat();if(!D){O("Open a chat before triggering a guided action.","warn");return}if(w!==D){if(w)g.delete(w);if(g.has(D))return;w=D,g.add(w),G()}if(I(D))return;let H=F();if(!K(H)){O("Composer is unavailable right now. Open the message input bar and try again.","warn");return}if(H.chatId!==null&&H.chatId!==D){O("Active chat changed; please try again.","warn");return}let B=H.text,U=a.settings.actions[c];if(c==="guided_response"&&!B.trim()){O("Type guidance in the input box before clicking Guided Response.","warn"),q();return}M(),b.delete(D);let re=Boolean(B.trim())&&(U.clearInputOnRun||c==="guided_impersonate");if(re&&!j("")){O("Composer is unavailable right now.","warn");return}let Ee=t.connections?.getActive?.()?.activeProfileId??null,xe={actionId:c,chatId:D,activeConnectionId:Ee,inputText:B,...c==="guided_swipe"&&v?.backgroundSwipe?{backgroundSwipe:!0}:{}};try{if(await Q("run_action",xe,300000),r)return}catch(W){if(r)return;if(re&&!I(D)){let J=F(),Me=t.getActiveChat().chatId;if(K(J)&&J.chatId===D&&Me===D&&!J.text)j(B)}let je=W instanceof Error?W.message:String(W);O(je,"error",7000)}}finally{if(h=!1,w)g.delete(w);G()}}function Te(c){let v=t.getActiveChat().chatId;if(r||!a)return;if(S(v)){O("Wait for the active guided generation to finish before restoring input.","warn");return}let f=F();if(!K(f)){O("Composer is unavailable right now — cannot restore input.","warn");return}if(f.chatId!==null&&f.chatId!==v){O("Active chat changed; please try again.","warn");return}if(!j(c.text)){O("Composer is unavailable right now — cannot restore input.","warn");return}q(),M()}function mt(){let c=t.getActiveChat().chatId;if(r||!a||S(c))return;if(!a.settings.inputRecovery.enabled)return;let v=F();if(!K(v)){O("Composer is unavailable right now — cannot clear input.","warn");return}if(v.chatId!==null&&v.chatId!==c){O("Active chat changed; please try again.","warn");return}if(!v.text){q(),M();return}if(!j("")){O("Composer is unavailable right now — cannot clear input.","warn");return}q(),M()}async function vt(){if(r||h)return;let{chatId:c}=t.getActiveChat();if(!c){O("Open a chat before removing the last continue.","warn");return}if(S(c))return;g.add(c),G(),b.delete(c);try{M(),await Q("remove_last_continue",{chatId:c})}catch(v){if(r)return;let f=v instanceof Error?v.message:String(v);O(f,"warn",7000)}finally{g.delete(c),G()}}async function bt(){if(r||h)return;let{chatId:c}=t.getActiveChat();if(!c){O("Open a chat before regenerating the last continue.","warn");return}if(S(c))return;g.add(c),G(),b.delete(c);try{M();let v=t.connections?.getActive?.()?.activeProfileId??null;await Q("regenerate_last_continue",{chatId:c,activeConnectionId:v},300000)}catch(v){if(r)return;let f=v instanceof Error?v.message:String(v);O(f,"error",7000)}finally{g.delete(c),G()}}async function Ke(){let c=t.getActiveChat().chatId;if(r)return;if(S(c)){O("Wait for the active guided generation to finish before clearing input recovery history.","warn");return}try{let v=await Q("clear_recovery");if(r)return;if(a){if(a={...a,recovery:v},Z(),m)V.updateRecovery(a.recovery,a.settings)}}catch(v){if(r)return;O(v instanceof Error?v.message:String(v),"error")}}let he=new Ue(t),ge=new _e(t),ae=new Oe(t),We=new Fe(t,{onTriggerAction:(c,v)=>{ft(c,v)},onAbortAction:(c)=>{if(r)return;Q("abort_action",{runId:c}).catch(()=>{return})},onRestoreLatest:()=>{let c=t.getActiveChat().chatId;if(r||!a||S(c))return;let v=rt(a.recovery);if(v)Te(v);else mt()},onRestoreEntry:(c)=>{Te(c)},onClearRecovery:()=>{Ke()},onRemoveLastContinue:()=>{vt()},onRegenerateLastContinue:()=>{bt()}}),V=new Ve(t,{onRefresh:()=>{if(r)return;M(),oe()},onSaveSettings:async(c,v)=>{if(r||!a)return;let f=++d;if(a={...a,settings:c},Z(),v?.rebuildDrawer)V.render(a,{force:!0});try{let w=await Q("save_settings",c);if(r||!a||f!==d)return;let D=ie(w,a.settings);if(a={...a,settings:w},!D){if(Z(),v?.rebuildDrawer)V.render(a)}}catch(w){if(r)return;if(O(`Failed saving settings: ${w instanceof Error?w.message:String(w)}`,"error"),f===d)oe()}},onRestoreEntry:(c)=>Te(c),onClearRecovery:()=>Ke()});m=V.isTabConnected();function $e(){if(r)return;if(se(),!m)m=!0,V.render(a);oe({onlyIfChanged:x})}if(!m)u=V.observeTabConnection(()=>{$e()}),i.push(()=>{se()});function ye(c){if(r)return;let v=t.getActiveChat().chatId;A(),P(),he.sync(I(v)),ge.onChatChanged(v),Z(),X(v),ae.onChatChanged(c!==void 0?c:v)}if(i.push(V.onActivate(()=>{$e()})),i.push(t.onBackendMessage((c)=>{if(r)return;let v=Ae(c)?c:{};if(v.type==="gg:reply"&&typeof v.requestId==="string"){let w=ne.get(v.requestId);if(!w)return;if(ne.delete(v.requestId),clearTimeout(w.timer),typeof v.error==="string"&&v.error)w.reject(Error(v.error));else w.resolve(v.result);return}let f=v;switch(f.type){case"gg:status":{o+=1;let w=typeof f.chatId==="string"&&f.chatId.length>0?f.chatId:void 0,D=Boolean(f.done)||Boolean(f.aborted)||Boolean(f.error),H=w?R.get(w):void 0,B=f.run?R.get(f.run.chatId):void 0;if(f.run){if(w&&f.run.chatId!==w&&D){if(R.delete(w),E.set(w,o),H!==void 0&&H.actionId!=="guided_impersonate"||f.aborted||f.error)b.delete(w)}if(!D||w!==void 0&&f.run.chatId!==w){if(B?.runId!==f.run.runId)b.delete(f.run.chatId);R.set(f.run.chatId,f.run),E.set(f.run.chatId,o)}else if(R.delete(f.run.chatId),E.set(f.run.chatId,o),f.run.actionId!=="guided_impersonate"||f.aborted||f.error)b.delete(f.run.chatId)}else if(w){if(R.delete(w),E.set(w,o),H!==void 0&&H.actionId!=="guided_impersonate"||f.aborted||f.error)b.delete(w)}else if(R.clear(),p=o,D)b.clear();if(P(),a)a={...a,activeRun:T};let U=t.getActiveChat().chatId;if(he.sync(I(U)),ge.handleStatusEvent(f,U),Z(),f.error)O(f.error,"error",7000);return}case"gg:impersonate-chunk":{if(typeof f.text==="string"){let w=f.chatId,H=(typeof w==="string"?w:null)??(R.size===1?Array.from(R.values())[0].chatId:T?.chatId??null),B=F(),U=t.getActiveChat().chatId;if(H!==null&&H!==U){if(f.done&&!f.aborted&&f.text.length>0)b.set(H,f.text);return}if(!K(B)||!U||B.chatId!==U){if(f.done&&!f.aborted&&f.text.length>0&&H){if(b.set(H,f.text),H===U)X(U)}return}if(j(f.text)){if(b.delete(U),f.done)q()}else if(f.done&&!f.aborted&&f.text.length>0)b.set(U,f.text)}return}case"gg:recovery-updated":{if(a&&Array.isArray(f.recovery)){if(a={...a,recovery:f.recovery},Z(),m)V.updateRecovery(a.recovery,a.settings)}return}case"gg:changed":{oe({onlyIfChanged:!0});return}case"gg:generation_metrics":{if(typeof f.chatId==="string"&&typeof f.messageId==="string"&&typeof f.swipeId==="number")ae.handleMetricsEvent(f);return}}})),i.push(t.events.on("CHAT_SWITCHED",(c)=>{ye(ze(c)??t.getActiveChat().chatId)})),i.push(t.events.on("CHAT_CHANGED",(c)=>{ye(ze(c)??t.getActiveChat().chatId)})),i.push(t.events.on("CHAT_DELETED",(c)=>{if(r)return;let v=Ot(c);if(!v)return;if(o+=1,E.set(v,o),R.delete(v),b.delete(v),k===v)A();g.delete(v),P();let f=t.getActiveChat().chatId;he.sync(I(f)),ge.onChatDeleted(v),ae.onChatDeleted(v),Z()})),i.push(t.events.on("MESSAGE_SWIPED",(c)=>{if(!r)ae.onMessageEvent(c)})),i.push(t.events.on("MESSAGE_EDITED",(c)=>{if(!r)ae.onMessageEvent(c)})),i.push(t.events.on("MESSAGE_DELETED",(c)=>{if(!r)ae.onMessageDeleted(c)})),t.connections?.subscribe)i.push(t.connections.subscribe(()=>{if(!r&&m)oe({onlyIfChanged:!0})}));let Xe=!1;try{if(t.state)i.push(t.state.subscribe("chat.active",()=>{ye()})),Xe=!0}catch{}if(!Xe){let c=t.getActiveChat().chatId,v=setInterval(()=>{if(r)return;let f=t.getActiveChat().chatId;if(f!==c)c=f,ye(f)},600);i.push(()=>clearInterval(v))}return t.ready(),oe(),()=>{try{V.flushPendingSaves()}catch{}if(r=!0,A(),y)clearTimeout(y),y=void 0;for(let c of i)try{c()}catch{}i.length=0;for(let c of ne.values())clearTimeout(c.timer),c.reject(Error("Guided Generations unloaded."));ne.clear(),g.clear(),R.clear(),E.clear(),b.clear();try{ae.destroy()}catch{}try{ge.destroy()}catch{}try{he.destroy()}catch{}try{We.destroy()}catch{}try{V.destroy()}catch{}try{C?.replaceChildren()}catch{}try{n()}catch{}}}export{cn as setup};

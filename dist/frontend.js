var It=["guided_response","guided_continue","guided_regenerate","guided_swipe","guided_impersonate"];var Bt=0,Gt=!0,Ot=[{value:"before_post_history",label:"Before Post-History (after chat history)",shortLabel:"Before Post-History",sublabel:"Places guidance right after chat history and before post-history preset blocks."},{value:"in_history",label:"In History (at depth)",shortLabel:"In History",sublabel:"Splices guidance inside chat history N messages back from the end."},{value:"pre_history",label:"Pre-History (before chat history)",shortLabel:"Pre-History",sublabel:"Places guidance after pre-history system prompts and before the first chat turn."},{value:"post_history",label:"Post-History (end of prompt)",shortLabel:"Post-History",sublabel:"Appends guidance at the very end of the assembled prompt (before any trailing prefill)."}];function Ft(e,t="before_post_history"){if(e==="before_post_history"||e==="in_history"||e==="pre_history"||e==="post_history")return e;return t}function Ct(e,t=0){if(typeof e==="number"&&Number.isFinite(e))return Math.max(0,Math.min(999,Math.floor(e)));return Math.max(0,Math.min(999,Math.floor(t)))}var Ut=[...It,"guided_scene","input_recovery"],ct=[{value:"after_native",label:"Inline (after native buttons)",shortLabel:"Inline",sublabel:"Sits directly next to Home, Regenerate, Continue, etc."},{value:"before_native",label:"Left side (before native buttons)",shortLabel:"Left",sublabel:"Placed at the start of the composer top action bar"},{value:"right",label:"Right side (top bar)",shortLabel:"Right",sublabel:"Aligned to the right side of the composer top action bar"},{value:"below_bar",label:"Separate row (below native buttons)",shortLabel:"New row",sublabel:"Shown on the dedicated extension toolbar row underneath"}];function li(e){return typeof e==="string"&&It.includes(e)}function di(e){return e==="input_recovery"||e==="guided_scene"||li(e)}function ut(e){if(e==="after_native"||e==="before_native"||e==="right"||e==="below_bar")return e;return"after_native"}function Tt(e){let t=[],n=new Set;if(Array.isArray(e))for(let i of e){if(!di(i)||n.has(i))continue;n.add(i),t.push(i)}for(let i of Ut)if(!n.has(i))n.add(i),t.push(i);return t}var xe={guided_response:{id:"guided_response",label:"Guided Response",shortLabel:"Response",description:"Steer the next AI reply using your composer text as temporary guidance without adding a user message.",tooltip:"Guided Response — steer next AI reply without sending a user message"},guided_continue:{id:"guided_continue",label:"Guided Continue",shortLabel:"Continue",description:"Continue the last AI message using optional guidance text and this option's profile & preset.",tooltip:"Guided Continue — continue last AI message (guided if input present)"},guided_regenerate:{id:"guided_regenerate",label:"Guided Regenerate",shortLabel:"Regenerate",description:"Replace the last AI message with a fresh regenerated reply using optional guidance text and this option's profile & preset.",tooltip:"Guided Regenerate — regenerate last AI reply (guided if input present)"},guided_swipe:{id:"guided_swipe",label:"Guided Swipe",shortLabel:"Swipe",description:"Generate a new swipe on the last AI message steered by your guidance text.",tooltip:"Guided Swipe — create a steered new swipe on the last AI message"},guided_impersonate:{id:"guided_impersonate",label:"Impersonation",shortLabel:"Impersonate",description:"Generate a user reply into the composer input box using your configured preset and optional outline.",tooltip:"Impersonate — draft user message into input box"}};var Be={id:"guided_scene",label:"Guided Scene",shortLabel:"Scene",description:"Jump or steer mid-chat into any character/group greeting or custom scene with optional adaptation and media preservation.",tooltip:"Guided Scene — open Scene workbench (hold when armed for quick actions)"},In={guided_response:xe.guided_response.label,guided_continue:xe.guided_continue.label,guided_regenerate:xe.guided_regenerate.label,guided_swipe:xe.guided_swipe.label,guided_impersonate:xe.guided_impersonate.label,guided_scene:Be.label,input_recovery:"Input Recovery"},Cn=[...Ot,{value:"append_last_user",label:"Append to Last User Message (OOC)",shortLabel:"Append Last User",sublabel:"Appends an OOC note to the latest user message in chat history (falls back to Before Post-History if the last turn is not a user message)."}];var Tn=[{value:"lightweight",label:"Lightweight (Character + Persona + Recent Turns)",shortLabel:"Lightweight",sublabel:"Fast, faithful scene adaptation without preset jailbreaks pushing past the opening."},{value:"full_preset",label:"Full Preset Assembly (Lorebooks + Preset + History)",shortLabel:"Full Preset",sublabel:"Assembles the full configured preset stack, lorebooks, and chat history."}],pt=20,Ze="scene-ready",Vt=`[OOC Scene Direction: Steer the roleplay naturally toward the upcoming scene setup below without quoting, copying, or preemptively playing out the scene itself.
{{pacing_instruction}}
{{delivery_instruction}}{{transition_note}}
Upcoming scene premise (for direction only — do not spoil or reproduce):
{{target_scene}}
{{readiness_instruction}}]`,Kt=`Adapt the target scene opening below so it follows seamlessly from the ongoing conversation while preserving its voice, tone, formatting, and core beats. Resolve continuity with prior events naturally without repeating what just happened.{{delivery_guidance}}{{custom_direction}}{{media_instructions}}
Output ONLY the adapted scene prose with no meta-commentary.`,zt=`Use the target scene below as a premise and structural inspiration to write a fresh scene entry grounded deeply in the current conversation, character dynamics, and established history. Do not feel bound to its exact phrasing, but fulfill its core situation and mood.{{delivery_guidance}}{{custom_direction}}{{media_instructions}}
Output ONLY the new scene prose with no meta-commentary.`,$t=`Write ONLY a brief, atmospheric transition (1 to 3 sentences) bridging the end of the current conversation into the upcoming scene opening below. Do NOT rewrite, quote, or continue past the upcoming scene—it will appear verbatim immediately after your bridge.{{delivery_guidance}}{{custom_direction}}
Output ONLY the short bridge prose with no meta-commentary or scene divider.`,Je={enabled:!0,connectionId:null,model:null,presetId:null,contextMode:"lightweight",contextTurns:pt,injectionRole:"system",guidancePosition:"before_post_history",guidanceDepth:0,keepMediaIntact:!0,applyRegex:!0,pacing:"drop_now",delivery:"time_skip",adjustmentMode:"verbatim",dropTarget:"new_message",steeringTemplate:Vt,adaptTemplate:Kt,summaryTemplate:zt,bridgeTemplate:$t,readinessTag:Ze};function At(e,t="before_post_history"){if(e==="before_post_history"||e==="in_history"||e==="pre_history"||e==="post_history"||e==="append_last_user")return e;return t}function ht(e,t=Je.pacing){if(e==="drop_now"||e==="next_turn"||e==="multi_turn")return e;return t}function Qe(e,t=Je.delivery){if(e==="cut"||e==="time_skip"||e==="bridge")return e;return t}function et(e,t=Je.adjustmentMode){if(e==="verbatim"||e==="context_adapt"||e==="summary_rewrite")return e;return t}function gt(e,t=Je.dropTarget){if(e==="new_message"||e==="new_swipe")return e;return t}function Rt(e,t=Je.contextMode){if(e==="lightweight"||e==="full_preset")return e;return t}function jt(e,t=pt){if(typeof e==="number"&&Number.isFinite(e))return Math.max(1,Math.min(200,Math.floor(e)));return Math.max(1,Math.min(200,Math.floor(t)))}var En=/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;function Mt(e,t=Ze){if(typeof e==="string"){let n=e.trim().replace(/^<\/?\s*/,"").replace(/\s*\/?>$/,"").trim();if(En.test(n))return n}return En.test(t)?t:Ze}function mt(e,t=Je){let n=e&&typeof e==="object"&&!Array.isArray(e)?e:{},i=(s)=>typeof s==="string"&&s.trim().length>0?s.trim():null,r=(s,d)=>s==="system"||s==="user"||s==="assistant"?s:d;return{enabled:typeof n.enabled==="boolean"?n.enabled:t.enabled,connectionId:"connectionId"in n?i(n.connectionId):t.connectionId,model:"model"in n?i(n.model):t.model,presetId:"presetId"in n?i(n.presetId):t.presetId,contextMode:Rt(n.contextMode,t.contextMode),contextTurns:jt(n.contextTurns,t.contextTurns),injectionRole:r(n.injectionRole,t.injectionRole),guidancePosition:At(n.guidancePosition,t.guidancePosition),guidanceDepth:Ct(n.guidanceDepth,t.guidanceDepth),keepMediaIntact:typeof n.keepMediaIntact==="boolean"?n.keepMediaIntact:t.keepMediaIntact,applyRegex:typeof n.applyRegex==="boolean"?n.applyRegex:t.applyRegex,pacing:ht(n.pacing,t.pacing),delivery:Qe(n.delivery,t.delivery),adjustmentMode:et(n.adjustmentMode,t.adjustmentMode),dropTarget:gt(n.dropTarget,t.dropTarget),steeringTemplate:typeof n.steeringTemplate==="string"?n.steeringTemplate:t.steeringTemplate,adaptTemplate:typeof n.adaptTemplate==="string"?n.adaptTemplate:t.adaptTemplate,summaryTemplate:typeof n.summaryTemplate==="string"?n.summaryTemplate:t.summaryTemplate,bridgeTemplate:typeof n.bridgeTemplate==="string"?n.bridgeTemplate:t.bridgeTemplate,readinessTag:Mt(n.readinessTag,t.readinessTag)}}var An={xPct:94,yPct:22};function vt(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function $e(e,t,n){if(!Number.isFinite(e))return t;if(t>n)return(t+n)/2;return Math.max(t,Math.min(n,e))}function _t(e,t=2,n=98){return $e(e,t,n)}function ci(e){return Boolean(e)&&(typeof e==="object"||typeof e==="function")&&typeof e.then==="function"}function ui(e){if(!vt(e))return null;if(typeof e.chatId==="string"&&e.chatId)return e.chatId;if(typeof e.id==="string"&&e.id)return e.id;if(vt(e.chat)&&typeof e.chat.id==="string"&&e.chat.id)return e.chat.id;return null}function Rn(e){let t=e.trim();if(!t)return"GG";let n=t.split(/[\s_-]+/).filter(Boolean);if(n.length>=2)return`${n[0][0]??""}${n[1][0]??""}`.toUpperCase();return t.slice(0,2).toUpperCase()}function Wt(e){return`/api/v1/characters/${encodeURIComponent(e)}/avatar?thumb=1`}function ft(e){if(typeof e!=="string")return;let t=e.trim();if(!t)return;if(t.startsWith("/")&&!t.startsWith("//"))return t;if(/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(t))return t;try{let n=new URL(t);if(n.protocol==="http:"||n.protocol==="https:")return t}catch{}return}function pi(e,t,n=0){return!(e.right+n<=t.left||e.left>=t.right+n||e.bottom+n<=t.top||e.top>=t.bottom+n)}class qt{ctx;heads=new Map;headItemRefs=new Map;characterCache=new Map;pendingCharacterFetches=new Set;disposers=[];rootEl=null;resizeCleanup=null;dragCleanup=null;suppressClickTimer=null;suppressNextClick=!1;isDragging=!1;pos;destroyed=!1;constructor(e){this.ctx=e;if(this.pos=this.loadPosition(),typeof this.ctx.events?.on==="function")try{this.disposers.push(this.ctx.events.on("CHAT_DELETED",(t)=>{this.onChatDeleted(ui(t))}))}catch{}}syncRuns(e,t){if(this.destroyed)return;let n=t!==void 0?t:this.safeGetActiveChatId();if(n){if(this.heads.get(n)?.status==="completed")this.heads.delete(n)}let i=new Map;for(let r of e){let s=r;if(s&&typeof s.chatId==="string"&&s.chatId.length>0)i.set(s.chatId,s)}for(let[r,s]of[...this.heads.entries()]){if(s.status==="completed")continue;if(!i.has(r))this.heads.delete(r)}for(let[,r]of i.entries())this.upsertFromActiveRun(r,n);this.render(n)}handleStatusEvent(e,t){if(this.destroyed)return;let n=t!==void 0?t:this.safeGetActiveChatId(),i=typeof e.chatId==="string"&&e.chatId.length>0?e.chatId:void 0,r=e.run??null,s=Boolean(e.done)||Boolean(e.aborted)||Boolean(e.error);if(i&&(s||!r||r.chatId!==i))this.finalizeChatRun(i,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n);let d=i===void 0&&s&&Boolean(e.error);if(r&&typeof r.chatId==="string"&&r.chatId.length>0){if(!s||d||i!==void 0&&r.chatId!==i)this.upsertFromActiveRun(r,n);else if(!i&&s)this.finalizeChatRun(r.chatId,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n)}else if(!i&&!d){for(let[u,o]of[...this.heads.entries()])if(o.status==="running"||o.status==="streaming")this.finalizeChatRun(u,{aborted:Boolean(e.aborted),hasError:Boolean(e.error)},n)}this.render(n)}onChatChanged(e){if(this.destroyed)return;let t=e!==void 0?e:this.safeGetActiveChatId();if(t){if(this.heads.get(t)?.status==="completed")this.heads.delete(t)}this.render(t)}onChatDeleted(e){if(this.destroyed||!e)return;if(this.heads.delete(e))this.render()}destroy(){if(this.destroyed)return;this.destroyed=!0,this.clearDragSession(),this.clearResizeListener(),this.clearSuppressClickTimer(),this.suppressNextClick=!1;for(let e of this.disposers)try{e()}catch{}if(this.disposers.length=0,this.heads.clear(),this.headItemRefs.clear(),this.characterCache.clear(),this.pendingCharacterFetches.clear(),this.rootEl)this.rootEl.remove(),this.rootEl=null}getCachedCharacter(e){let t=this.characterCache.get(e);if(t!==void 0)this.characterCache.delete(e),this.characterCache.set(e,t);return t}setCachedCharacter(e,t){if(this.characterCache.has(e))this.characterCache.delete(e);else if(this.characterCache.size>=200){let n=this.characterCache.keys().next().value;if(n!==void 0)this.characterCache.delete(n)}this.characterCache.set(e,t)}upsertFromActiveRun(e,t){let n=this.heads.get(e.chatId),i=t===e.chatId?this.safeGetActiveChat():null,r=(typeof e.characterId==="string"&&e.characterId.length>0?e.characterId:void 0)??n?.characterId??(typeof i?.characterId==="string"&&i.characterId.length>0?i.characterId:void 0),s=r?this.getCachedCharacter(r):void 0,d=(typeof e.characterName==="string"&&e.characterName.trim().length>0?e.characterName.trim():void 0)??n?.characterName??s?.name,u=ft(e.avatarUrl)??ft(n?.avatarUrl)??ft(s?.avatarUrl)??(r?Wt(r):void 0),o=e.hasContentOutput?"streaming":"running",m={chatId:e.chatId,runId:e.runId,status:o,startedAt:e.startedAt,...r?{characterId:r}:{},...d?{characterName:d}:{},...u?{avatarUrl:u}:{},...n?.avatarFailed&&n.avatarUrl===u?{avatarFailed:!0}:{}};if(this.heads.set(e.chatId,m),r&&!d&&!this.characterCache.has(r))this.resolveCharacterMeta(r)}finalizeChatRun(e,t,n){let i=this.heads.get(e);if(t.aborted||t.hasError||n===e){this.heads.delete(e);return}if(i)this.heads.set(e,{...i,status:"completed"});else this.heads.set(e,{chatId:e,runId:`gg-completed-${e}`,status:"completed",startedAt:Date.now()})}async resolveCharacterMeta(e){if(this.destroyed||!e)return;if(this.pendingCharacterFetches.has(e)||this.characterCache.has(e))return;let t=this.ctx.characters;if(typeof t?.get!=="function")return;this.pendingCharacterFetches.add(e);try{let n=await Promise.resolve(t.get(e));if(this.destroyed)return;if(!vt(n)){this.setCachedCharacter(e,{});return}let i=typeof n.name==="string"&&n.name.trim().length>0?n.name.trim():void 0,r=Wt(e),s=ft(n.avatarUrl)??ft(n.avatar_url),d=s??r;this.setCachedCharacter(e,{...i?{name:i}:{},avatarUrl:d});let u=!1;for(let o of this.heads.values()){if(o.characterId!==e)continue;if(i&&!o.characterName)o.characterName=i,u=!0;if(s&&(!o.avatarUrl||o.avatarUrl===r)){if(o.avatarUrl!==s)o.avatarUrl=s,delete o.avatarFailed,u=!0}else if(d&&!o.avatarUrl)o.avatarUrl=d,u=!0}if(u)this.render()}catch{if(!this.destroyed)this.setCachedCharacter(e,{})}finally{this.pendingCharacterFetches.delete(e)}}render(e){if(this.destroyed)return;if(typeof document>"u"||!document.body)return;let t=e!==void 0?e:this.safeGetActiveChatId(),{nativeChatIds:n,nativeContainer:i}=this.heads.size>0?this.scanNativeChatHeads():{nativeChatIds:new Set,nativeContainer:null},r=[];for(let m of this.heads.values()){if(m.chatId===t)continue;if(n.has(m.chatId))continue;r.push(m)}if(r.length===0){if(this.clearDragSession(),this.clearResizeListener(),this.headItemRefs.clear(),this.rootEl)this.rootEl.remove(),this.rootEl=null;return}let s=!this.isDragging,d=this.getViewportSize(),u=s&&i?this.resolveNativeBounds(i,d.vw,d.vh):null;if(!this.rootEl)this.rootEl=document.createElement("div"),this.rootEl.className="gg-chat-heads-root",this.rootEl.setAttribute("data-gg-chat-heads-root","true"),this.attachDragHandlers(this.rootEl),this.ensureResizeListener();let o=new Set(r.map((m)=>m.chatId));for(let[m,c]of[...this.headItemRefs.entries()])if(!o.has(m))c.item.remove(),this.headItemRefs.delete(m);for(let m=0;m<r.length;m+=1){let c=r[m],h=this.headItemRefs.get(c.chatId);if(h)this.updateHeadItem(h,c);else h=this.buildHeadItem(c),this.headItemRefs.set(c.chatId,h);if(this.rootEl.children[m]!==h.item)this.rootEl.insertBefore(h.item,this.rootEl.children[m]??null)}if(this.applyRootPosition(this.rootEl,r.length,{avoidNative:s,nativeBox:u,viewport:d}),!this.rootEl.isConnected)document.body.append(this.rootEl)}buildHeadItem(e){let t=e.chatId,n=document.createElement("div");n.className="gg-chat-head-item";let i=document.createElement("button");i.type="button",i.className="gg-chat-head",i.setAttribute("data-gg-chat-head","true"),i.setAttribute("data-chat-id",t);let r=document.createElement("span");r.className="gg-chat-head-badge",r.setAttribute("aria-hidden","true"),i.append(r),i.addEventListener("contextmenu",(d)=>{if(d.preventDefault(),d.stopPropagation(),!this.isDragging&&this.heads.get(t)?.status==="completed")this.dismissCompletedHead(t)}),i.addEventListener("click",(d)=>{if(d.preventDefault(),d.stopPropagation(),this.suppressNextClick){this.suppressNextClick=!1,this.clearSuppressClickTimer();return}this.navigateToChat(t,()=>{if(this.destroyed)return;if(this.heads.get(t)?.status==="completed")this.heads.delete(t),this.render()})}),n.append(i);let s={item:n,btn:i,badge:r,img:null,initials:null,pip:null,dismissBtn:null};return this.updateHeadItem(s,e),s}updateHeadItem(e,t){let{item:n,btn:i,badge:r}=e;if(e.lastStatus!==t.status)i.classList.toggle("is-running",t.status==="running"||t.status==="streaming"),i.classList.toggle("is-streaming",t.status==="streaming"),i.classList.toggle("is-completed",t.status==="completed"),i.setAttribute("data-status",t.status);let s=t.characterName||t.chatId,d=t.status==="completed"?"Generation completed — click to open chat":t.status==="streaming"?"Streaming response in background — click to open chat":"Generating response in background — click to open chat",u=`${s}: ${d}`;if(e.lastLabel!==u)i.setAttribute("aria-label",u),i.title=u,e.lastLabel=u;let o=t.avatarUrl??(t.characterId?Wt(t.characterId):void 0),m=Boolean(t.avatarFailed);if(e.lastAvatarUrl!==o||e.lastAvatarFailed!==m||e.lastDisplayName!==s||!e.img&&!e.initials){if(o&&!m){if(e.initials)e.initials.remove(),e.initials=null;if(e.img){if(e.img.getAttribute("src")!==o)e.img.src=o;e.img.alt=s}else{let c=document.createElement("img");c.className="gg-chat-head-avatar",c.src=o,c.alt=s,c.draggable=!1,c.addEventListener("error",()=>{if(this.destroyed)return;let h=this.heads.get(t.chatId);if(h)h.avatarFailed=!0;if(c.isConnected){let S=this.heads.get(t.chatId)?.characterName||t.chatId,p=document.createElement("span");p.className="gg-chat-head-initials",p.textContent=Rn(S),c.replaceWith(p);let l=this.headItemRefs.get(t.chatId);if(l&&l.img===c)l.img=null,l.initials=p,l.lastAvatarFailed=!0}}),i.insertBefore(c,r),e.img=c}}else{if(e.img)e.img.remove(),e.img=null;let c=Rn(s);if(e.initials)e.initials.textContent=c;else{let h=document.createElement("span");h.className="gg-chat-head-initials",h.textContent=c,i.insertBefore(h,r),e.initials=h}}e.lastAvatarUrl=o,e.lastAvatarFailed=m}if(t.status==="completed"){if(!e.pip){let c=document.createElement("span");c.className="gg-chat-head-pip",c.setAttribute("aria-hidden","true"),i.append(c),e.pip=c}}else if(e.pip)e.pip.remove(),e.pip=null;if(t.status==="completed")if(e.dismissBtn){if(e.lastDisplayName!==s)e.dismissBtn.setAttribute("aria-label",`Dismiss ${s}`)}else{let c=document.createElement("button");c.type="button",c.className="gg-chat-head-dismiss",c.setAttribute("data-gg-chat-head-dismiss","true"),c.setAttribute("aria-label",`Dismiss ${s}`),c.title="Dismiss",c.textContent="×",c.addEventListener("click",(h)=>{h.preventDefault(),h.stopPropagation(),this.dismissCompletedHead(t.chatId)}),n.append(c),e.dismissBtn=c}else if(e.dismissBtn)e.dismissBtn.remove(),e.dismissBtn=null;e.lastStatus=t.status,e.lastDisplayName=s}dismissCompletedHead(e){if(this.destroyed)return;if(this.heads.get(e)?.status==="completed")this.heads.delete(e),this.render()}scanNativeChatHeads(){let e=new Set,t=null;if(typeof document>"u"||!document.body)return{nativeChatIds:e,nativeContainer:t};let n=document.body.querySelectorAll("[data-head-idx][data-chat-id]:not([data-gg-chat-head]), [data-chat-head][data-chat-id]:not([data-gg-chat-head]), body > * > [data-chat-id]:not([data-gg-chat-head])"),i=new Map;for(let r of n){if(r.hasAttribute("data-gg-chat-head"))continue;if(this.rootEl?.contains(r)||r.closest("[data-gg-chat-heads-root]"))continue;let s=r.getAttribute("data-chat-id");if(!s)continue;if(r.hasAttribute("data-head-idx")||r.hasAttribute("data-chat-head")){if(e.add(s),!t){let o=r.parentElement;t=!o||o===document.body?r:o}continue}let u=r.parentElement;if(u&&u.parentElement===document.body){let o=i.get(u);if(o===void 0){let m=typeof u.className==="string"?u.className:"";o=/ChatHeads/i.test(m)||u.querySelector("[data-head-idx]")!==null,i.set(u,o)}if(o)e.add(s)}}return{nativeChatIds:e,nativeContainer:t}}findNativeChatHeadsContainer(){return this.scanNativeChatHeads().nativeContainer}getViewportSize(){let e=typeof window<"u"?window:typeof document<"u"?document.defaultView:null,t=e&&typeof e.innerWidth==="number"&&e.innerWidth>0?e.innerWidth:(typeof document<"u"?document.documentElement?.clientWidth:0)||1024,n=e&&typeof e.innerHeight==="number"&&e.innerHeight>0?e.innerHeight:(typeof document<"u"?document.documentElement?.clientHeight:0)||768;return{vw:t,vh:n}}getStackDimensions(e,t){let n=Math.max(1,e),i=60,r=n*48+Math.max(0,n-1)*10+12,s=Math.max(60,t-24);return{width:60,height:Math.min(r,s)}}clampCenterPos(e,t,n){let{vw:i,vh:r}=n??this.getViewportSize(),{width:s,height:d}=this.getStackDimensions(t,r),u=12+s/2,o=i-12-s/2,m=12+d/2,c=r-12-d/2,h=$e(e.xPct/100*i,u,o),S=$e(e.yPct/100*r,m,c);return{xPct:h/i*100,yPct:S/r*100}}resolveNativeBounds(e,t,n){try{let p=e.getBoundingClientRect?.();if(p&&p.width>0&&p.height>0)return{left:p.left,top:p.top,right:p.right,bottom:p.bottom}}catch{}let i=e.querySelectorAll("[data-head-idx], [data-chat-head]"),r=Math.max(1,i.length),s=e.style?.flexDirection==="row",d=s?r*48+Math.max(0,r-1)*8+12:60,u=s?60:r*48+Math.max(0,r-1)*8+12,o=parseFloat(e.style?.left??""),m=parseFloat(e.style?.top??"");if(Number.isFinite(o)&&Number.isFinite(m)&&o>=0&&m>=0)return{left:o,top:m,right:o+d,bottom:m+u};let c=this.readNativeStoredPosition();if(c){let p,l;if(c.xPct<0||c.yPct<0)p=t-d-12,l=Math.round((n-u)/2);else if(c.xPct<=1&&c.yPct<=1)p=$e(c.xPct*t,12,t-d-12),l=$e(c.yPct*n,12,n-u-12);else p=$e(c.xPct/100*t,12,t-d-12),l=$e(c.yPct/100*n,12,n-u-12);return{left:p,top:l,right:p+d,bottom:l+u}}let h=t-d-12,S=Math.round((n-u)/2);return{left:h,top:S,right:h+d,bottom:S+u}}readNativeStoredPosition(){try{let t=this.getStorage()?.getItem("lumiverse:chatHeadsPos");if(!t)return null;let n=JSON.parse(t);if(vt(n)&&typeof n.xPct==="number"&&Number.isFinite(n.xPct)&&typeof n.yPct==="number"&&Number.isFinite(n.yPct))return{xPct:n.xPct,yPct:n.yPct}}catch{}return null}attachDragHandlers(e){e.addEventListener("click",()=>{if(this.suppressNextClick)this.suppressNextClick=!1,this.clearSuppressClickTimer()}),e.addEventListener("pointerdown",(t)=>{if(this.destroyed)return;if(t.pointerType==="mouse"&&t.button!==0)return;if(typeof document>"u")return;let n=t.target;if(n?.closest?.("[data-gg-chat-head-dismiss]"))return;if(this.isDragging)return;this.clearSuppressClickTimer(),this.suppressNextClick=!1,this.clearDragSession();let{pointerId:i,clientX:r,clientY:s}=t,d=this.getViewportSize(),u=this.rootEl?.children.length||this.heads.size||1,o=parseFloat(e.style.left),m=parseFloat(e.style.top),c=Number.isFinite(o)&&Number.isFinite(m)?{xPct:o,yPct:m}:this.clampCenterPos(this.pos,u,d),h=!1,S=!1,p=null,l=null,y=0,E=0,w=!1,H=()=>{if(p!==null)clearTimeout(p),p=null},M=()=>{if(l!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(l);l=null}},x=()=>{if(!w||this.destroyed)return;if(w=!1,this.pos=this.clampCenterPos({xPct:c.xPct+y/d.vw*100,yPct:c.yPct+E/d.vh*100},u,d),this.rootEl)this.applyRootPosition(this.rootEl,u,{avoidNative:!1,viewport:d})},B=(N)=>{if(N.pointerId!==i)return;let k=N.clientX-r,z=N.clientY-s;if(!h&&Math.hypot(k,z)>6){h=!0,H(),this.isDragging=!0,this.suppressNextClick=!0,e.classList.add("is-dragging");try{e.setPointerCapture?.(i)}catch{}}if(!h)return;if(y=k,E=z,w=!0,typeof requestAnimationFrame==="function"){if(l===null)l=requestAnimationFrame(()=>{if(l=null,S||this.destroyed)return;x()})}else x()},T=()=>{if(S)return;if(S=!0,H(),M(),h&&w)x();this.clearDragSession(),e.classList.remove("is-dragging");try{if(e.hasPointerCapture?.(i))e.releasePointerCapture?.(i)}catch{}if(h){if(this.savePosition(this.pos),this.rootEl){let N=this.rootEl.children.length||this.heads.size||1;this.applyRootPosition(this.rootEl,N)}this.clearSuppressClickTimer(),this.suppressClickTimer=setTimeout(()=>{this.suppressClickTimer=null,this.suppressNextClick=!1},350)}},v=n?.closest?.("[data-gg-chat-head]")?.getAttribute("data-chat-id")??null;if(t.pointerType==="touch"&&v&&this.heads.get(v)?.status==="completed")p=setTimeout(()=>{if(p=null,h||S||this.destroyed)return;if(this.heads.get(v)?.status!=="completed")return;this.suppressNextClick=!0,this.clearSuppressClickTimer(),this.suppressClickTimer=setTimeout(()=>{this.suppressClickTimer=null,this.suppressNextClick=!1},350),T(),this.dismissCompletedHead(v)},450);let A=(N)=>{if(N.pointerId!==i)return;T()},G=(N)=>{if(N.pointerId!==i)return;if(N.target!==e)return;T()},_=()=>{T()},O=(N)=>{if(h&&N.cancelable)N.preventDefault()},C=typeof window<"u"?window:document.defaultView;if(document.addEventListener("pointermove",B,!0),document.addEventListener("pointerup",A,!0),document.addEventListener("pointercancel",A,!0),t.pointerType==="touch")document.addEventListener("touchmove",O,{capture:!0,passive:!1});e.addEventListener("lostpointercapture",G),C?.addEventListener("blur",_),this.dragCleanup=()=>{if(H(),M(),document.removeEventListener("pointermove",B,!0),document.removeEventListener("pointerup",A,!0),document.removeEventListener("pointercancel",A,!0),t.pointerType==="touch")document.removeEventListener("touchmove",O,!0);e.removeEventListener("lostpointercapture",G),C?.removeEventListener("blur",_)}})}clearDragSession(){if(this.isDragging=!1,this.rootEl?.classList.remove("is-dragging"),this.dragCleanup){let e=this.dragCleanup;this.dragCleanup=null,e()}}clearSuppressClickTimer(){if(this.suppressClickTimer!==null)clearTimeout(this.suppressClickTimer),this.suppressClickTimer=null}ensureResizeListener(){if(this.resizeCleanup)return;let e=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(!e)return;let t=null,n=()=>{if(this.destroyed||!this.rootEl)return;let r=this.rootEl.children.length||this.heads.size||1;this.applyRootPosition(this.rootEl,r,{avoidNative:!this.isDragging})},i=()=>{if(this.destroyed||!this.rootEl)return;if(typeof requestAnimationFrame==="function"){if(t!==null)return;t=requestAnimationFrame(()=>{t=null,n()})}else n()};e.addEventListener("resize",i),this.resizeCleanup=()=>{if(t!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(t);t=null}e.removeEventListener("resize",i)}}clearResizeListener(){if(this.resizeCleanup){let e=this.resizeCleanup;this.resizeCleanup=null,e()}}applyRootPosition(e,t=this.heads.size||1,n={}){let i=n.viewport??this.getViewportSize(),{vw:r,vh:s}=i,{width:d,height:u}=this.getStackDimensions(t,s),o=this.clampCenterPos(this.pos,t,i),m=o.xPct/100*r,c=o.yPct/100*s;if(n.avoidNative!==!1){let p=n.nativeBox!==void 0?n.nativeBox:(()=>{let l=this.findNativeChatHeadsContainer();return l?this.resolveNativeBounds(l,r,s):null})();if(p){let l=12+d/2,y=r-12-d/2,E=12+u/2,w=s-12-u/2,H={left:m-d/2,top:c-u/2,right:m+d/2,bottom:c+u/2};if(pi(H,p,8)){let M=p.bottom+8+u/2,x=p.top-8-u/2,B=p.left-8-d/2,T=p.right+8+d/2;if(M>=E&&M<=w)c=M;else if(x>=E&&x<=w)c=x;else if(B>=l&&B<=y)m=B;else if(T>=l&&T<=y)m=T}}}let h=_t(m/r*100,0,100),S=_t(c/s*100,0,100);e.style.left=`${h}%`,e.style.top=`${S}%`}getStorage(){try{return typeof localStorage<"u"?localStorage:typeof window<"u"?window.localStorage:null}catch{return null}}loadPosition(){try{let e=this.getStorage()?.getItem("gg:chatHeadsPos");if(!e)return{...An};let t=JSON.parse(e);if(vt(t)&&typeof t.xPct==="number"&&Number.isFinite(t.xPct)&&typeof t.yPct==="number"&&Number.isFinite(t.yPct))return{xPct:_t(t.xPct),yPct:_t(t.yPct)}}catch{}return{...An}}savePosition(e){try{this.getStorage()?.setItem("gg:chatHeadsPos",JSON.stringify(e))}catch{}}navigateToChat(e,t){try{let n=this.ctx.host?.surfaces;if(n&&typeof n.invoke==="function"){let i=n.invoke({kind:"route",id:"/chat/:chatId"},{chatId:e});if(ci(i)){Promise.resolve(i).then(()=>{t?.()},()=>{if(this.fallbackHistoryNavigate(e))t?.()});return}t?.();return}}catch{}if(this.fallbackHistoryNavigate(e))t?.()}fallbackHistoryNavigate(e){try{let t=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(t?.history&&typeof t.history.pushState==="function"){t.history.pushState(null,"",`/chat/${encodeURIComponent(e)}`);let n=t.PopStateEvent??(typeof PopStateEvent<"u"?PopStateEvent:Event);return t.dispatchEvent(new n("popstate")),!0}}catch{}return!1}safeGetActiveChat(){try{return this.ctx.getActiveChat?.()??null}catch{return null}}safeGetActiveChatId(){return this.safeGetActiveChat()?.chatId??null}}function ae(e,t="1.85"){return`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round">${e}</svg>`}var Mn=ae('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),_n='<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M4 10h16"/><path d="m10 4-2 6"/><path d="m16 4-2 6"/>',kn=ae('<circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',"1.8"),tt={basic:ae('<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="10" cy="18" r="2"/>',"1.8"),advanced:ae('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',"1.8"),scene:ae(_n,"1.8")},Xt='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',nt={guided_response:ae('<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/>'),guided_continue:ae('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>'),guided_regenerate:Mn,guided_swipe:ae('<path d="m9 18 6-6-6-6"/>'),guided_impersonate:ae('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),guided_scene:ae(_n),input_recovery:ae('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>')},Yt={remove_last_continue:ae('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>'),regenerate_last_continue:Mn},Zt={history:ae('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),clear_history:ae('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>')},it={drop_next_turn:ae('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>'),drop_now:ae('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),pause:ae('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'),resume:ae('<polygon points="6 4 20 12 6 20 6 4"/>'),cancel:ae('<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>')};function rt(e,t=68){let n=Number.isFinite(t)?Math.max(4,Math.floor(t)):60,i=e.replace(/\s+/g," ").trim();if(i.length<=n)return i;return`${i.slice(0,n-1)}…`}function Pn(e,t){if(e.length===0)return null;if(t)return e.find((n)=>n.id===t)??e[0]??null;return e[0]??null}function Nn(e){return e[0]?.text?` ("${e[0].text.replace(/\s+/g," ").trim().slice(0,48)}")`:""}function hi(e){let t=ut(e.settings.toolbarPlacement),n=Tt(e.settings.buttonOrder),i=0;if(e.settings.actions.guided_response?.enabled)i|=1;if(e.settings.actions.guided_continue?.enabled)i|=2;if(e.settings.actions.guided_regenerate?.enabled)i|=4;if(e.settings.actions.guided_swipe?.enabled)i|=8;if(e.settings.actions.guided_impersonate?.enabled)i|=16;if(e.settings.inputRecovery.enabled)i|=32;if(e.settings.guidedScene?.enabled)i|=64;let s=Boolean(e.settings.inputRecovery.enabled)&&e.recovery.length>0;return{placement:t,order:n,enabledMask:i,hasActiveChat:Boolean(e.hasActiveChat),hasActiveRun:Boolean(e.activeRun),isBusy:Boolean(e.isBusy||e.activeRun),activeRunId:e.activeRun?.runId??null,activeRunActionId:e.activeRun?.actionId??null,armedSceneStatus:e.armedScene?.status??null,armedScenePacing:e.armedScene?.pacing??null,hasRecovery:s,latestRecoveryPreview:s?Nn(e.recovery):""}}function Hn(e,t){if(e.placement!==t.placement||e.enabledMask!==t.enabledMask||e.hasActiveChat!==t.hasActiveChat||e.hasActiveRun!==t.hasActiveRun||e.isBusy!==t.isBusy||e.activeRunId!==t.activeRunId||e.activeRunActionId!==t.activeRunActionId||e.armedSceneStatus!==t.armedSceneStatus||e.armedScenePacing!==t.armedScenePacing||e.order.length!==t.order.length)return!1;for(let n=0;n<e.order.length;n+=1)if(e.order[n]!==t.order[n])return!1;return!0}function gi(e,t){return Hn(e,t)&&e.hasRecovery===t.hasRecovery&&e.latestRecoveryPreview===t.latestRecoveryPreview}var Jt=["gg-actions-host","gg-actions-host--row","is-before-native","is-right"],mi=450,fi=10,Ln=150,Dn=3000,vi=0,bi=250;class Qt{ctx;handlers;actionsMountRoot;toolbarMountRoot=null;toolbarEl;buttons=[];buttonPool=new Map;latestState=null;activeActionId=null;activeHoldCancel=null;suppressNextHoldClick=!1;suppressHoldClickActionId=null;suppressHoldClickUntil=0;clearSuppressHoldClickTimer=null;holdReleaseCleanup=null;postHoldCleanup=null;continueMenu=null;latestRecovery=[];lastRenderSignature=null;lastChatId=void 0;destroyed=!1;onKeyDown;onFocusIn;constructor(e,t){this.ctx=e;this.handlers=t;this.actionsMountRoot=e.ui.mount("chat_actions"),this.actionsMountRoot.classList.add("gg-actions-host"),this.toolbarEl=document.createElement("div"),this.toolbarEl.className="gg-toolbar",this.toolbarEl.setAttribute("role","toolbar"),this.toolbarEl.setAttribute("aria-label","Guided Generations actions"),this.onKeyDown=(n)=>{this.handleToolbarKeyDown(n)},this.onFocusIn=(n)=>{let i=n.target;if(!i||i.tagName!=="BUTTON"||i.disabled)return;let r=i.getAttribute("data-gg-action");if(r)this.activeActionId=r,this.applyRovingTabIndex()},this.toolbarEl.addEventListener("keydown",this.onKeyDown),this.toolbarEl.addEventListener("focusin",this.onFocusIn),this.actionsMountRoot.replaceChildren(this.toolbarEl)}render(e){if(this.destroyed)return;this.latestState=e;let t=e.chatId!==void 0&&this.lastChatId!==void 0&&e.chatId!==this.lastChatId;if(e.chatId!==void 0)this.lastChatId=e.chatId;let n=hi(e),i=n.placement==="below_bar"?this.toolbarMountRoot:this.actionsMountRoot,r=i!==null&&this.toolbarEl.parentElement===i&&this.toolbarEl.childElementCount===this.buttons.length;if(this.lastRenderSignature!==null&&r&&gi(this.lastRenderSignature,n)){if(this.latestRecovery=e.recovery,t)this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold();else if(this.continueMenu?.kind==="recovery")this.continueMenu.refreshRecovery?.();return}let s=!t&&this.continueMenu?.kind==="recovery"&&this.lastRenderSignature!==null&&r&&Hn(this.lastRenderSignature,n);if(!s)this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold();this.latestRecovery=e.recovery;let d=[];for(let p of n.order)if(p==="input_recovery"?Boolean(e.settings.inputRecovery.enabled):p==="guided_scene"?Boolean(e.settings.guidedScene?.enabled):Boolean(e.settings.actions[p]?.enabled))d.push(p);if(this.buttons.length===d.length&&this.toolbarEl.childElementCount===d.length&&this.buttons.every((p,l)=>p.getAttribute("data-gg-action")===d[l])){for(let p of d){let l=this.buttonPool.get(p);if(l)this.syncOptionButton(l,p,e)}if(this.applyRovingTabIndex(),this.applyPlacement(n.placement,d.length>0),this.lastRenderSignature=n,s)this.continueMenu?.refreshRecovery?.();return}if(s)this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold();let o=typeof document<"u"?document.activeElement:null,m=o&&this.toolbarEl.contains(o)?o.getAttribute?.("data-gg-action"):null,c=[];for(let p of d){let l=this.getOrCreateOptionButton(p);this.syncOptionButton(l,p,e),c.push(l.btn)}this.buttons=c,this.toolbarEl.replaceChildren(...c);let h=m?this.buttons.find((p)=>!p.disabled&&p.getAttribute("data-gg-action")===m):void 0;if(h&&m)this.activeActionId=m;this.applyRovingTabIndex();let S=c.length>0;if(this.applyPlacement(n.placement,S),this.lastRenderSignature=n,h)h.focus()}applyRovingTabIndex(){let e=this.buttons.filter((n)=>!n.disabled);if(e.length===0){for(let n of this.buttons)n.tabIndex=-1;return}let t=(this.activeActionId?e.find((n)=>n.getAttribute("data-gg-action")===this.activeActionId):void 0)??e[0];this.activeActionId=t.getAttribute("data-gg-action")??null;for(let n of this.buttons)n.tabIndex=n===t?0:-1}handleToolbarKeyDown(e){if(e.altKey||e.ctrlKey||e.metaKey)return;let t=e.key;if(t!=="ArrowRight"&&t!=="ArrowLeft"&&t!=="ArrowDown"&&t!=="ArrowUp"&&t!=="Home"&&t!=="End")return;let n=this.buttons.filter((u)=>!u.disabled);if(n.length===0)return;let i=typeof document<"u"?document.activeElement:null,r=n.findIndex((u)=>u===i);if(r===-1)r=n.findIndex((u)=>u.tabIndex===0);if(r===-1)r=0;let s=r;if(t==="ArrowRight"||t==="ArrowDown")s=(r+1)%n.length;else if(t==="ArrowLeft"||t==="ArrowUp")s=(r-1+n.length)%n.length;else if(t==="Home")s=0;else if(t==="End")s=n.length-1;let d=n[s];e.preventDefault(),this.activeActionId=d.getAttribute("data-gg-action")??null,this.applyRovingTabIndex(),d.focus()}getOrCreateOptionButton(e){let t=this.buttonPool.get(e);if(t)return t;let n=document.createElement("button");n.type="button",n.className="gg-btn",n.setAttribute("data-gg-action",e);let i={btn:n,iconKey:""};if(e==="input_recovery")i.iconKey="input_recovery",n.innerHTML=nt.input_recovery,this.attachRecoveryHoldHandlers(n);else if(e==="guided_scene")this.attachSceneHoldHandlers(n);else if(e==="guided_swipe")this.attachSwipeHoldHandlers(n);else if(e==="guided_continue")this.attachContinueHoldHandlers(n);else n.addEventListener("click",(r)=>{r.preventDefault(),r.stopPropagation();let s=this.latestState?.activeRun;if(s?.actionId===e)this.handlers.onAbortAction(s.runId);else this.handlers.onTriggerAction(e)});return this.buttonPool.set(e,i),i}syncOptionButton(e,t,n){if(t==="input_recovery"){this.syncRecoveryButton(e,n);return}if(t==="guided_scene"){this.syncSceneButton(e,n);return}this.syncActionButton(e,t,n)}syncSceneButton(e,t){let{btn:n}=e,i=t.activeRun?.actionId==="guided_scene",r=Boolean(t.activeRun)&&!i,s=Boolean(t.isBusy)&&!t.activeRun,d=r||s,u=t.armedScene??null,o=!i&&Boolean(u),m=o&&u?.status==="paused",c=this.continueMenu?.kind==="scene"&&this.continueMenu.anchorBtn===n;if(n.classList.toggle("is-running",i),n.classList.toggle("is-armed",o),n.classList.toggle("is-paused",m),n.classList.toggle("is-dimmed",d),n.disabled=d,i)n.setAttribute("aria-label",`Stop ${Be.label}`),n.title=`Stop ${Be.label}`,n.removeAttribute("aria-haspopup"),n.removeAttribute("aria-expanded"),n.removeAttribute("aria-keyshortcuts");else if(o){let S=u?.greetingLabel||(u?.greetingSource==="custom"?"Custom Scene":"Greeting"),p=m?`Guided Scene paused (${S})`:`Guided Scene steering (${S})`;n.setAttribute("aria-label",p),n.title=`${p} — click to open Guided Scene, hold for steering controls`,n.setAttribute("aria-haspopup","menu"),n.setAttribute("aria-expanded",c?"true":"false"),n.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter")}else n.setAttribute("aria-label",Be.label),n.title=Be.tooltip,n.removeAttribute("aria-haspopup"),n.removeAttribute("aria-expanded"),n.removeAttribute("aria-keyshortcuts");let h=i?"stop":"guided_scene";if(e.iconKey!==h)e.iconKey=h,n.innerHTML=i?Xt:nt.guided_scene}syncActionButton(e,t,n){let{btn:i}=e,r=xe[t],s=n.activeRun?.actionId===t,d=Boolean(n.activeRun)&&!s,u=Boolean(n.isBusy)&&!n.activeRun,o=!n.hasActiveChat||d||u;if(i.classList.toggle("is-running",s),i.classList.toggle("is-dimmed",o),i.disabled=o,i.setAttribute("aria-label",s?`Stop ${r.label}`:r.label),t==="guided_swipe"&&!s)i.setAttribute("aria-keyshortcuts","Control+Enter Meta+Enter"),i.removeAttribute("aria-haspopup"),i.removeAttribute("aria-expanded"),i.title="Guided Swipe — click to swipe, hold (or Ctrl+Click) to swipe in background";else if(t==="guided_continue"&&!s)i.setAttribute("aria-haspopup","menu"),i.setAttribute("aria-expanded","false"),i.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter"),i.title="Guided Continue — click to continue, hold for continue options";else i.removeAttribute("aria-keyshortcuts"),i.removeAttribute("aria-haspopup"),i.removeAttribute("aria-expanded"),i.title=s?`Stop ${r.label}`:r.tooltip;let m=s?"stop":t;if(e.iconKey!==m)e.iconKey=m,i.innerHTML=s?Xt:nt[t]}clearActiveHold(){if(this.activeHoldCancel){let e=this.activeHoldCancel;this.activeHoldCancel=null,e()}}clearPostHoldClickSuppression(){if(this.suppressNextHoldClick=!1,this.suppressHoldClickActionId=null,this.suppressHoldClickUntil=0,this.clearSuppressHoldClickTimer!==null)clearTimeout(this.clearSuppressHoldClickTimer),this.clearSuppressHoldClickTimer=null;if(this.holdReleaseCleanup){let e=this.holdReleaseCleanup;this.holdReleaseCleanup=null,e()}if(this.postHoldCleanup){let e=this.postHoldCleanup;this.postHoldCleanup=null,e()}}isHoldClickSuppressed(e){if(!this.suppressNextHoldClick)return!1;if(this.suppressHoldClickUntil>0&&Date.now()>this.suppressHoldClickUntil)return this.clearPostHoldClickSuppression(),!1;if(e&&this.suppressHoldClickActionId!==null){if(e.getAttribute("data-gg-action")!==this.suppressHoldClickActionId)return!1}return!0}armPostHoldClickSuppression(e,t){if(this.clearPostHoldClickSuppression(),this.suppressNextHoldClick=!0,this.suppressHoldClickActionId=e.getAttribute("data-gg-action"),this.suppressHoldClickUntil=Date.now()+Dn,this.postHoldCleanup=t??null,typeof document>"u")return;let n=typeof window<"u"?window:document.defaultView,i=()=>{if(document.removeEventListener("pointerup",d,!0),document.removeEventListener("pointercancel",d,!0),document.removeEventListener("visibilitychange",s),n?.removeEventListener("blur",r),this.holdReleaseCleanup===i)this.holdReleaseCleanup=null},r=()=>{this.clearPostHoldClickSuppression()},s=()=>{if(document.visibilityState==="hidden")this.clearPostHoldClickSuppression()},d=(u)=>{if(i(),this.clearSuppressHoldClickTimer!==null)clearTimeout(this.clearSuppressHoldClickTimer);let o=u.type==="pointercancel"||u.pointerType==="mouse"?vi:bi;this.suppressHoldClickUntil=Date.now()+o,this.clearSuppressHoldClickTimer=setTimeout(()=>{this.clearSuppressHoldClickTimer=null,this.clearPostHoldClickSuppression()},o)};this.holdReleaseCleanup=i,document.addEventListener("pointerup",d,!0),document.addEventListener("pointercancel",d,!0),document.addEventListener("visibilitychange",s),n?.addEventListener("blur",r),this.clearSuppressHoldClickTimer=setTimeout(()=>{this.clearSuppressHoldClickTimer=null,this.clearPostHoldClickSuppression()},Dn)}attachLongPressHandlers(e,t,n){let i={timer:void 0,x:0,y:0,fired:!1},r=typeof document<"u"?document:null,s=typeof window<"u"?window:r?.defaultView??null,d=!1,u=()=>{if(!d)return;d=!1,s?.removeEventListener("blur",m),r?.removeEventListener("visibilitychange",m)},o=()=>{if(d)return;d=!0,s?.addEventListener("blur",m),r?.addEventListener("visibilitychange",m)},m=()=>{if(u(),i.timer!==void 0)clearTimeout(i.timer),i.timer=void 0;if(e.classList.remove("is-holding"),this.activeHoldCancel===m)this.activeHoldCancel=null};e.addEventListener("pointerdown",(c)=>{if(e.disabled||this.latestState?.activeRun||this.latestState?.isBusy)return;if(n.canHold&&!n.canHold())return;if(!c.isPrimary)return;if(c.pointerType==="mouse"&&c.button!==0)return;this.clearActiveHold(),this.clearPostHoldClickSuppression(),m(),i.fired=!1,i.x=c.clientX,i.y=c.clientY,e.classList.add("is-holding"),this.activeHoldCancel=m,o(),i.timer=setTimeout(()=>{if(i.timer=void 0,u(),e.classList.remove("is-holding"),this.activeHoldCancel===m)this.activeHoldCancel=null;if(n.canHold&&!n.canHold())return;i.fired=!0,this.armPostHoldClickSuppression(e,()=>{i.fired=!1}),n.onHold()},mi)}),e.addEventListener("pointermove",(c)=>{if(i.timer===void 0)return;let h=c.clientX-i.x,S=c.clientY-i.y;if(Math.hypot(h,S)>fi)m()}),e.addEventListener("pointerup",m),e.addEventListener("pointercancel",m),e.addEventListener("pointerleave",(c)=>{if(c.pointerType==="touch")return;m()}),e.addEventListener("contextmenu",(c)=>{if(i.timer!==void 0||i.fired||this.isHoldClickSuppressed(e))c.preventDefault(),c.stopPropagation()}),e.addEventListener("click",(c)=>{if(i.fired||this.isHoldClickSuppressed(e)){i.fired=!1,this.clearPostHoldClickSuppression(),c.preventDefault(),c.stopPropagation();return}c.preventDefault(),c.stopPropagation();let h=this.latestState?.activeRun;if(t!=="input_recovery"&&h?.actionId===t)this.handlers.onAbortAction(h.runId);else n.onClick(c)}),e.addEventListener("keydown",(c)=>{if(e.disabled||this.latestState?.activeRun||this.latestState?.isBusy)return;if(n.onShortcutKeyDown(c))c.preventDefault(),c.stopPropagation()})}attachSceneHoldHandlers(e){let t=()=>Boolean(this.latestState?.armedScene);this.attachLongPressHandlers(e,"guided_scene",{canHold:t,onClick:(n)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),(n.ctrlKey||n.metaKey)&&t()){this.openSceneMenu(e);return}this.handlers.onToggleSceneDrawer?.()},onHold:()=>{if(t())this.openSceneMenu(e)},onShortcutKeyDown:(n)=>{if(!t())return!1;if(n.shiftKey&&n.key==="F10"||n.altKey&&n.key==="ArrowUp"||(n.ctrlKey||n.metaKey)&&n.key==="Enter")return this.openSceneMenu(e),!0;return!1}})}openSceneMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;let t=this.latestState?.armedScene;if(!t)return;this.closeContinueMenu({restoreFocus:!1});let n=t.status==="paused",i=document.createElement("div");i.className="gg-dropup-menu",i.setAttribute("role","menu"),i.setAttribute("aria-label","Guided Scene steering controls");let r=!n&&t.pacing==="next_turn",s=[{id:"drop_next_turn",label:"Drop Next Turn",icon:it.drop_next_turn,danger:!1,disabled:r,onSelect:()=>this.handlers.onSceneDropNextTurn?.()},{id:"drop_now",label:"Drop Now",icon:it.drop_now,danger:!1,disabled:!1,onSelect:()=>this.handlers.onSceneDropNow?.()},{id:"toggle_pause",label:n?"Resume Steering":"Pause Steering",icon:n?it.resume:it.pause,danger:!1,disabled:!1,onSelect:()=>this.handlers.onSceneTogglePause?.()},{id:"cancel_steering",label:"Cancel Steering",icon:it.cancel,danger:!0,disabled:!1,onSelect:()=>this.handlers.onSceneCancelSteering?.()}],d=[];for(let m of s){let c=document.createElement("button");if(c.type="button",c.className=`gg-dropup-item${m.danger?" is-danger":""}`,c.setAttribute("role","menuitem"),c.setAttribute("data-gg-menu-action",m.id),c.disabled=m.disabled,m.disabled)c.setAttribute("aria-disabled","true");c.tabIndex=-1,c.innerHTML=`${m.icon}<span>${m.label}</span>`,c.addEventListener("click",(h)=>{if(c.disabled)return;h.preventDefault(),h.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),m.onSelect()}),d.push(c),i.append(c)}document.body.append(i),e.setAttribute("aria-expanded","true");let u=this.positionContinueMenu(i,e),o=this.attachDropupMenuLifecycle({menuEl:i,anchorBtn:e,items:d,initialAnchorRect:u});this.continueMenu={kind:"scene",menuEl:i,anchorBtn:e,items:d,cleanup:o},(d.find((m)=>!m.disabled)??d[0])?.focus()}attachSwipeHoldHandlers(e){this.attachLongPressHandlers(e,"guided_swipe",{onClick:(t)=>{this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:Boolean(t.ctrlKey||t.metaKey)})},onHold:()=>{this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:!0})},onShortcutKeyDown:(t)=>{if((t.ctrlKey||t.metaKey)&&(t.key==="Enter"||t.key===" "))return this.handlers.onTriggerAction("guided_swipe",{backgroundSwipe:!0}),!0;return!1}})}attachContinueHoldHandlers(e){this.attachLongPressHandlers(e,"guided_continue",{onClick:(t)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),t.ctrlKey||t.metaKey){this.openContinueMenu(e);return}this.handlers.onTriggerAction("guided_continue")},onHold:()=>{this.openContinueMenu(e)},onShortcutKeyDown:(t)=>{if(t.shiftKey&&t.key==="F10"||t.altKey&&t.key==="ArrowUp"||(t.ctrlKey||t.metaKey)&&t.key==="Enter")return this.openContinueMenu(e),!0;return!1}})}openContinueMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;this.closeContinueMenu({restoreFocus:!1});let t=document.createElement("div");t.className="gg-dropup-menu",t.setAttribute("role","menu"),t.setAttribute("aria-label","Guided Continue options");let n=[{id:"remove_last_continue",label:"Remove the last continue",icon:Yt.remove_last_continue,onSelect:()=>this.handlers.onRemoveLastContinue()},{id:"regenerate_last_continue",label:"Regenerate last continue",icon:Yt.regenerate_last_continue,onSelect:()=>this.handlers.onRegenerateLastContinue()}],i=[];for(let d of n){let u=document.createElement("button");u.type="button",u.className="gg-dropup-item",u.setAttribute("role","menuitem"),u.setAttribute("data-gg-menu-action",d.id),u.tabIndex=-1,u.innerHTML=`${d.icon}<span>${d.label}</span>`,u.addEventListener("click",(o)=>{o.preventDefault(),o.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),d.onSelect()}),i.push(u),t.append(u)}document.body.append(t),e.setAttribute("aria-expanded","true");let r=this.positionContinueMenu(t,e),s=this.attachDropupMenuLifecycle({menuEl:t,anchorBtn:e,items:i,initialAnchorRect:r});this.continueMenu={kind:"continue",menuEl:t,anchorBtn:e,items:i,cleanup:s},i[0]?.focus()}attachDropupMenuLifecycle(e){let{menuEl:t,anchorBtn:n,items:i,initialAnchorRect:r,onBackKey:s}=e,d=Date.now(),u=(I)=>{let v=i.filter((G)=>!G.disabled),A=v.indexOf(document.activeElement);if(I.key==="ArrowDown"){if(I.preventDefault(),I.stopPropagation(),v.length===0)return;let G=A===-1?0:(A+1)%v.length;v[G]?.focus()}else if(I.key==="ArrowUp"){if(I.preventDefault(),I.stopPropagation(),v.length===0)return;let G=A<=0?v.length-1:A-1;v[G]?.focus()}else if(I.key==="Home")I.preventDefault(),I.stopPropagation(),v[0]?.focus();else if(I.key==="End")I.preventDefault(),I.stopPropagation(),v[v.length-1]?.focus();else if(s&&(I.key==="ArrowLeft"||I.key==="Backspace")&&s())I.preventDefault(),I.stopPropagation();else if(I.key==="Escape"||I.key==="Tab")I.preventDefault(),I.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},o=(I)=>{if(I.key==="Escape")I.preventDefault(),I.stopPropagation(),this.closeContinueMenu({restoreFocus:!0})},m=(I)=>{if(Date.now()-d<Ln)return;let v=I.target;if(v&&(t.contains(v)||v===n||n.contains(v)))return;this.closeContinueMenu({restoreFocus:!1})},c=(I)=>{if(this.isHoldClickSuppressed(n))return;if(Date.now()-d<Ln)return;let v=I.target;if(v&&(t.contains(v)||v===n||n.contains(v)))return;this.closeContinueMenu({restoreFocus:!1})},h=typeof window<"u"?window:document.defaultView,S=h?.visualViewport??null,p=h?.innerWidth,l=h?.innerHeight,y=r,E=null,w=()=>{if(!n.isConnected)return!0;let I=n.getBoundingClientRect();return Math.abs(I.left-y.left)>0.5||Math.abs(I.top-y.top)>0.5||Math.abs(I.right-y.right)>0.5||Math.abs(I.bottom-y.bottom)>0.5},H=()=>{if(typeof requestAnimationFrame==="function"){if(E!==null)return;E=requestAnimationFrame(()=>{if(E=null,this.destroyed||!n.isConnected||n.disabled||!t.isConnected)return;y=this.positionContinueMenu(t,n)})}else y=this.positionContinueMenu(t,n)},M=(I)=>{if(!n.isConnected||n.disabled||!t.isConnected){this.closeContinueMenu({restoreFocus:!1});return}let v=h?.innerWidth,A=h?.innerHeight,G=v!==p||A!==l;if(p=v,l=A,!I&&!S&&!G){this.closeContinueMenu({restoreFocus:!1});return}H()},x=()=>{M(!1)},B=()=>{M(!0)},T=(I)=>{let v=I.target;if(v&&typeof v.nodeType==="number"&&t.contains(v))return;let A=v===null||v===document||v===h||v===document.documentElement||v===document.body,G=v!==null&&typeof v.contains==="function"&&v.contains(n);if(!A&&!G&&!w())return;this.closeContinueMenu({restoreFocus:!1})};return t.addEventListener("keydown",u),document.addEventListener("keydown",o,!0),document.addEventListener("pointerdown",m,!0),document.addEventListener("click",c,!0),document.addEventListener("scroll",T,{capture:!0,passive:!0}),h?.addEventListener("resize",x),S?.addEventListener("resize",B),()=>{if(E!==null){if(typeof cancelAnimationFrame==="function")cancelAnimationFrame(E);E=null}t.removeEventListener("keydown",u),document.removeEventListener("keydown",o,!0),document.removeEventListener("pointerdown",m,!0),document.removeEventListener("click",c,!0),document.removeEventListener("scroll",T,{capture:!0}),h?.removeEventListener("resize",x),S?.removeEventListener("resize",B),t.remove()}}positionContinueMenu(e,t){let n=e.querySelector(".gg-dropup-history-list"),i=n?e.querySelector(".gg-dropup-header"):null;if(e.style.maxHeight)e.style.maxHeight="";if(e.style.overflowY)e.style.overflowY="";if(n&&n.style.maxHeight)n.style.maxHeight="";let r=t.getBoundingClientRect(),s=typeof window<"u"?window:document.defaultView,d=typeof getComputedStyle==="function"?getComputedStyle:s?.getComputedStyle?.bind(s),u=d&&document.body?d(document.body):null,o=u?parseFloat(u.zoom):NaN,m=u&&typeof u.getPropertyValue==="function"?parseFloat(u.getPropertyValue("scale")):NaN,c=u&&typeof u.getPropertyValue==="function"?parseFloat(u.getPropertyValue("--lumiverse-ui-scale")):NaN,h=Number.isFinite(o)&&o>0&&o!==1?o:Number.isFinite(m)&&m>0&&m!==1?m:Number.isFinite(c)&&c>0&&c!==1?c:1,S=s&&typeof s.innerWidth==="number"?s.innerWidth:document.documentElement?.clientWidth||1024,p=s&&typeof s.innerHeight==="number"?s.innerHeight:document.documentElement?.clientHeight||768,l=s?.visualViewport,y=l&&typeof l.width==="number"&&Number.isFinite(l.width)&&l.width>0&&l.width<S?l.width:S,E=l&&typeof l.height==="number"&&Number.isFinite(l.height)&&l.height>0&&l.height<p?l.height:p,{offsetWidth:w,offsetHeight:H}=e,M=n?n.offsetHeight:0,x=i?i.offsetHeight:0,B=w*h,T=H*h,I=6,v=8,A=Math.max(v,y-B-v),G=Math.max(v,Math.min(r.left,A)),_=r.top,O=E-r.bottom,C=T+I*h+v,N=_<C&&O>_,k="",z="",ee;if(N){let pe=Math.max(v/h,r.bottom/h+I);k=`${pe}px`,ee=Math.max(0,E-pe*h-v)}else z=`${(E-r.top)/h+I}px`,ee=Math.max(0,_-I*h-v);let j=Math.max(0,Math.floor(ee/h)),oe=null;if(n){let pe=M>0&&H>=M?H-M:(x||32)+12;oe=Math.min(220,Math.max(0,j-pe))}if(e.style.left=`${G/h}px`,e.style.top=k,e.style.bottom=z,e.style.maxHeight=`${j}px`,e.style.overflowY="auto",n&&oe!==null)n.style.maxHeight=`${oe}px`;return r}closeContinueMenu(e){let t=this.continueMenu;if(!t)return;if(this.continueMenu=null,t.anchorBtn.setAttribute("aria-expanded","false"),t.cleanup(),e.restoreFocus&&t.anchorBtn.isConnected&&!t.anchorBtn.disabled)t.anchorBtn.focus()}syncRecoveryButton(e,t){let{btn:n}=e,i=t.recovery.length>0,r=Boolean(t.activeRun||t.isBusy),s=Nn(t.recovery),d=this.continueMenu?.kind==="recovery"&&this.continueMenu.anchorBtn===n;if(n.classList.toggle("is-dimmed",r),n.disabled=r,n.setAttribute("aria-label",i?"Restore last input":"Clear current input"),!r)n.setAttribute("aria-haspopup","menu"),n.setAttribute("aria-expanded",d?"true":"false"),n.setAttribute("aria-keyshortcuts","Shift+F10 Alt+ArrowUp Control+Enter Meta+Enter");else n.removeAttribute("aria-haspopup"),n.removeAttribute("aria-expanded"),n.removeAttribute("aria-keyshortcuts");n.title=i?`Restore last cleared input${s}`:"Input Recovery — clear current input"}attachRecoveryHoldHandlers(e){this.attachLongPressHandlers(e,"input_recovery",{onClick:(t)=>{if(this.continueMenu!==null&&this.continueMenu.anchorBtn===e){this.closeContinueMenu({restoreFocus:!0});return}if(this.closeContinueMenu({restoreFocus:!1}),t.ctrlKey||t.metaKey){this.openRecoveryMenu(e);return}this.handlers.onRestoreLatest()},onHold:()=>{this.openRecoveryMenu(e)},onShortcutKeyDown:(t)=>{if(t.shiftKey&&t.key==="F10"||t.altKey&&t.key==="ArrowUp"||(t.ctrlKey||t.metaKey)&&t.key==="Enter")return this.openRecoveryMenu(e),!0;return!1}})}openRecoveryMenu(e){if(this.destroyed||typeof document>"u"||!document.body)return;this.closeContinueMenu({restoreFocus:!1});let t=document.createElement("div");t.className="gg-dropup-menu",t.setAttribute("role","menu"),t.setAttribute("aria-label","Input Recovery options");let n=[],i=!1,r=()=>this.latestRecovery.map((S)=>({id:S.id,text:S.text,actionId:S.actionId})),s=r(),d=()=>{if(s.length!==this.latestRecovery.length)return!0;for(let S=0;S<s.length;S+=1){let p=s[S],l=this.latestRecovery[S];if(p.id!==l.id||p.text!==l.text||p.actionId!==l.actionId)return!0}return!1},u=(S=!0)=>{i=!1,s=r(),n.length=0,t.replaceChildren(),t.setAttribute("aria-label","Input Recovery options");let p=this.latestRecovery.length===0,l=[{id:"history",label:"History",icon:Zt.history,disabled:!1,onSelect:()=>{o()}},{id:"clear_history",label:"Clear History",icon:Zt.clear_history,disabled:p,onSelect:()=>{if(this.latestRecovery.length===0)return;this.closeContinueMenu({restoreFocus:!1}),this.handlers.onClearRecovery?.()}}];for(let y of l){let E=document.createElement("button");if(E.type="button",E.className="gg-dropup-item",E.setAttribute("role","menuitem"),E.setAttribute("data-gg-menu-action",y.id),E.tabIndex=-1,y.disabled)E.disabled=!0,E.setAttribute("aria-disabled","true"),E.style.opacity="0.45",E.style.cursor="not-allowed";E.innerHTML=`${y.icon}<span>${y.label}</span>`,E.addEventListener("click",(w)=>{if(w.preventDefault(),w.stopPropagation(),y.disabled)return;y.onSelect()}),n.push(E),t.append(E)}if(t.isConnected){if(this.positionContinueMenu(t,e),S)n[0]?.focus()}},o=(S=!0)=>{i=!0,s=r(),n.length=0,t.replaceChildren(),t.setAttribute("aria-label","Input Recovery History");let p=document.createElement("div");p.className="gg-dropup-header",p.style.flexShrink="0";let l=document.createElement("button");l.type="button",l.className="gg-dropup-back",l.setAttribute("data-gg-menu-action","back"),l.setAttribute("aria-label","Back to Input Recovery options"),l.setAttribute("aria-keyshortcuts","ArrowLeft Backspace"),l.tabIndex=-1,l.textContent="← Back",l.addEventListener("click",(w)=>{w.preventDefault(),w.stopPropagation(),u()});let y=document.createElement("span");y.className="gg-dropup-title",y.textContent=`History (${this.latestRecovery.length})`,p.append(l,y),t.append(p),n.push(l);let E=document.createElement("div");if(E.className="gg-dropup-history-list",E.style.minHeight="0",this.latestRecovery.length===0){let w=document.createElement("div");w.className="gg-dropup-empty",w.setAttribute("role","status"),w.textContent="No saved inputs yet.",E.append(w),t.append(E)}else{for(let w of this.latestRecovery){let H=xe[w.actionId]?.label??w.actionId,M=rt(w.text,56),x=document.createElement("button");x.type="button",x.className="gg-dropup-item gg-dropup-history-item",x.setAttribute("role","menuitem"),x.setAttribute("data-gg-menu-action","restore_recovery_entry"),x.setAttribute("data-gg-recovery-id",w.id),x.setAttribute("aria-label",`Restore ${H} draft: ${rt(w.text,40)}`),x.title=w.text,x.tabIndex=-1;let B=document.createElement("span");B.className="gg-dropup-history-tag",B.textContent=H;let T=document.createElement("span");T.className="gg-dropup-history-snippet",T.textContent=M,x.append(B,T),x.addEventListener("click",(I)=>{if(I.preventDefault(),I.stopPropagation(),this.closeContinueMenu({restoreFocus:!1}),this.handlers.onRestoreEntry)this.handlers.onRestoreEntry(w);else this.handlers.onRestoreLatest()}),n.push(x),E.append(x)}t.append(E)}if(t.isConnected){if(this.positionContinueMenu(t,e),S)(this.latestRecovery.length>0?n[1]??n[0]:n[0])?.focus()}},m=()=>{if(!d())return;let S=typeof document<"u"?document.activeElement:null,p=Boolean(S&&t.contains(S)),l=p?S.getAttribute?.("data-gg-recovery-id"):null,y=p?S.getAttribute?.("data-gg-menu-action"):null;if(i)o(!1);else u(!1);if(p)((l?n.find((w)=>!w.disabled&&w.getAttribute("data-gg-recovery-id")===l):void 0)??(y?n.find((w)=>!w.disabled&&w.getAttribute("data-gg-menu-action")===y):void 0)??n.find((w)=>!w.disabled))?.focus()};u(),document.body.append(t),e.setAttribute("aria-expanded","true");let c=this.positionContinueMenu(t,e),h=this.attachDropupMenuLifecycle({menuEl:t,anchorBtn:e,items:n,initialAnchorRect:c,onBackKey:()=>{if(!i)return!1;return u(),!0}});this.continueMenu={kind:"recovery",menuEl:t,anchorBtn:e,items:n,cleanup:h,refreshRecovery:m},n[0]?.focus()}applyPlacement(e,t){if(this.toolbarEl.style.display=t?"inline-flex":"none",e==="below_bar"){if(!this.toolbarMountRoot)this.toolbarMountRoot=this.ctx.ui.mount("chat_toolbar");if(this.resetHostElement(this.actionsMountRoot,!0),this.toolbarMountRoot.classList.remove(...Jt),this.toolbarMountRoot.classList.add("gg-actions-host--row"),this.toolbarMountRoot.style.display=t?"flex":"none",this.toolbarEl.parentElement!==this.toolbarMountRoot)this.toolbarMountRoot.replaceChildren(this.toolbarEl);return}if(this.toolbarMountRoot)this.resetHostElement(this.toolbarMountRoot,!0);if(this.actionsMountRoot.classList.remove(...Jt),this.actionsMountRoot.classList.add("gg-actions-host"),e==="before_native")this.actionsMountRoot.classList.add("is-before-native");else if(e==="right")this.actionsMountRoot.classList.add("is-right");if(this.actionsMountRoot.style.display=t?"inline-flex":"none",this.toolbarEl.parentElement!==this.actionsMountRoot)this.actionsMountRoot.replaceChildren(this.toolbarEl)}resetHostElement(e,t){if(e.classList.remove(...Jt),e.style.display="none",t)e.replaceChildren()}destroy(){if(this.destroyed)return;if(this.destroyed=!0,this.closeContinueMenu({restoreFocus:!1}),this.clearActiveHold(),this.clearPostHoldClickSuppression(),this.toolbarEl.removeEventListener("keydown",this.onKeyDown),this.toolbarEl.removeEventListener("focusin",this.onFocusIn),this.buttons=[],this.buttonPool.clear(),this.latestState=null,this.activeActionId=null,this.lastRenderSignature=null,this.lastChatId=void 0,this.toolbarEl.replaceChildren(),this.resetHostElement(this.actionsMountRoot,!0),this.toolbarMountRoot)this.resetHostElement(this.toolbarMountRoot,!0)}}var Bn=[0,50,150];function ve(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function yi(e){if(!ve(e)||typeof e.id!=="string")return null;let t={id:e.id};if(typeof e.chat_id==="string")t.chat_id=e.chat_id;if(typeof e.swipe_id==="number")t.swipe_id=e.swipe_id;if(ve(e.extra))t.extra=e.extra;return t}function Si(e,t,n){return Boolean(e&&e.id===n&&(typeof e.chat_id!=="string"||e.chat_id===t)&&typeof e.swipe_id==="number"&&ve(e.extra)&&Object.keys(e.extra).length>0)}function Gn(e){let t=Array.isArray(e)?e:ve(e)&&Array.isArray(e.data)?e.data:ve(e)&&Array.isArray(e.items)?e.items:[],n=[];for(let i of t)if(ve(i)&&typeof i.id==="string")n.push(i);return n}function On(e,t,n){if(t>=n)return!0;if(ve(e)&&typeof e.total==="number"&&e.total>t)return!0;return!1}function xi(e){let n=(e instanceof Error?e.message:typeof e==="string"?e:"").toUpperCase();return n.includes("PERMISSION_DENIED")||n.includes("SPINDLE_FRONTEND_INACTIVE")||n.includes("STALE_GENERATION")||n.includes("NOT FOUND")||n.includes("404")||n.includes("403")||n.includes("401")}class en{ctx;pending=new Map;scheduledKeys=new Set;inFlightByMessage=new Map;inFlightTailReads=new Map;retryTimers=new Map;nextRevision=0;destroyed=!1;constructor(e){this.ctx=e}makeKey(e,t,n){return`${e}:${t}:${n}`}setPendingEntry(e,t){if(this.pending.has(e))this.pending.delete(e);else if(this.pending.size>=100){let n=this.pending.keys().next().value;if(n!==void 0)this.pending.delete(n),this.scheduledKeys.delete(n),this.clearRetryTimer(n)}this.pending.set(e,t)}handleMetricsEvent(e){if(this.destroyed)return;if(typeof e.chatId!=="string"||!e.chatId||typeof e.messageId!=="string"||!e.messageId||typeof e.swipeId!=="number"||!Number.isInteger(e.swipeId)||e.swipeId<0)return;if(e.tokenCount===void 0&&e.generationMetrics===void 0)return;let t=this.makeKey(e.chatId,e.messageId,e.swipeId),n=this.pending.get(t),i={key:t,chatId:e.chatId,messageId:e.messageId,swipeId:e.swipeId,tokenCount:e.tokenCount!==void 0?e.tokenCount:n?.tokenCount,generationMetrics:e.generationMetrics!==void 0?e.generationMetrics:n?.generationMetrics,lastKnownSwipeId:n?.lastKnownSwipeId,pendingFallback:n?.pendingFallback??null,revision:++this.nextRevision,attempts:0};this.setPendingEntry(t,i),this.clearRetryTimer(t),this.enqueueFlush(t)}onMessageEvent(e){if(this.destroyed||this.pending.size===0)return;let t=ve(e)?e:null,n=t&&ve(t.message)?t.message:null,i=typeof n?.id==="string"?n.id:typeof t?.messageId==="string"?t.messageId:null;if(!i)return;let r=typeof t?.chatId==="string"?t.chatId:typeof n?.chat_id==="string"?n.chat_id:null,s=typeof t?.action==="string"?t.action:null,d=s==="deleted"&&typeof t?.swipeId==="number"?t.swipeId:null,u=typeof n?.swipe_id==="number"?n.swipe_id:s!=="deleted"&&typeof t?.swipeId==="number"?t.swipeId:void 0,o=yi(n);if(d!==null){let m=[];for(let[c,h]of[...this.pending.entries()]){if(h.messageId!==i)continue;if(r&&h.chatId!==r)continue;if(h.swipeId===d)this.pending.delete(c),this.scheduledKeys.delete(c),this.clearRetryTimer(c);else if(h.swipeId>d){this.pending.delete(c),this.scheduledKeys.delete(c),this.clearRetryTimer(c);let S=h.swipeId-1;m.push({...h,swipeId:S,lastKnownSwipeId:void 0,pendingFallback:null,key:this.makeKey(h.chatId,h.messageId,S),revision:++this.nextRevision})}}for(let c of m){let h=this.pending.get(c.key);if(!h||c.revision>h.revision)this.scheduledKeys.delete(c.key),this.clearRetryTimer(c.key),this.setPendingEntry(c.key,c)}}for(let[m,c]of[...this.pending.entries()]){if(c.messageId!==i)continue;if(r&&c.chatId!==r)continue;if(u!==void 0&&u!==c.swipeId){c.lastKnownSwipeId=u,c.pendingFallback=null;continue}if(u===c.swipeId)c.lastKnownSwipeId=u;c.attempts=0,this.enqueueFlush(m,o)}}onChatChanged(e){if(this.destroyed||this.pending.size===0)return;let t=typeof e==="string"&&e.length>0?e:this.safeGetActiveChatId();if(!t)return;for(let[n,i]of[...this.pending.entries()]){if(i.chatId!==t)continue;if(i.lastKnownSwipeId!==void 0&&i.lastKnownSwipeId!==i.swipeId)continue;i.attempts=0,this.enqueueFlush(n)}}onChatDeleted(e){if(this.destroyed||!e||this.pending.size===0)return;for(let[t,n]of[...this.pending.entries()]){if(n.chatId!==e)continue;this.pending.delete(t),this.scheduledKeys.delete(t),this.clearRetryTimer(t)}}onMessageDeleted(e){if(this.destroyed||this.pending.size===0)return;let t=ve(e)?e:null,n=t&&ve(t.message)?t.message:null,i=typeof n?.id==="string"?n.id:typeof t?.messageId==="string"?t.messageId:typeof t?.id==="string"?t.id:null;if(!i)return;let r=typeof t?.chatId==="string"?t.chatId:typeof t?.chat_id==="string"?t.chat_id:typeof n?.chat_id==="string"?n.chat_id:null;for(let[s,d]of[...this.pending.entries()]){if(d.messageId!==i)continue;if(r&&d.chatId!==r)continue;this.pending.delete(s),this.scheduledKeys.delete(s),this.clearRetryTimer(s)}}destroy(){if(this.destroyed)return;this.destroyed=!0,this.pending.clear(),this.scheduledKeys.clear(),this.inFlightByMessage.clear(),this.inFlightTailReads.clear();for(let e of this.retryTimers.values())clearTimeout(e);this.retryTimers.clear()}enqueueFlush(e,t=null){if(this.destroyed)return;let n=this.pending.get(e);if(!n)return;if(t!==null)n.pendingFallback=t;if(this.scheduledKeys.has(e))return;this.scheduledKeys.add(e);let i=`${n.chatId}:${n.messageId}`,s=(this.inFlightByMessage.get(i)??Promise.resolve()).catch(()=>{return}).then(async()=>{if(this.scheduledKeys.delete(e),this.destroyed)return;await this.flushKey(e,t)}).catch(()=>{return}).finally(()=>{if(this.inFlightByMessage.get(i)===s)this.inFlightByMessage.delete(i)});this.inFlightByMessage.set(i,s)}fetchTailPage(e,t,n){let i=`${t}:${n}`,r=this.inFlightTailReads.get(i);if(r)return r;let s;try{s=Promise.resolve(e(t,{limit:n,tail:!0}))}catch(u){return Promise.reject(u)}let d=s.finally(()=>{if(this.inFlightTailReads.get(i)===d)this.inFlightTailReads.delete(i)});return this.inFlightTailReads.set(i,d),d}async flushKey(e,t){if(this.destroyed)return;let n=this.pending.get(e);if(!n)return;let i=n.pendingFallback??t;n.pendingFallback=null;let r={...n},s=this.resolveUpdateMessage();if(!s){this.deleteIfSameRevision(e,r.revision);return}let d=null;if(Si(i,r.chatId,r.messageId))d=i;let u=d?null:this.resolveGetSingleMessage(),o=d?null:this.resolveGetMessages();if(!d&&u)try{let h=await u(r.messageId);if(this.destroyed)return;if(ve(h)&&typeof h.id==="string"&&h.id===r.messageId&&(typeof h.chat_id!=="string"||h.chat_id===r.chatId))d=h}catch(h){if(this.destroyed)return;if(!o){this.handleFlushFailure(e,r,h);return}}if(!d&&o){let h;try{h=await this.fetchTailPage(o,r.chatId,50)}catch(p){if(this.destroyed)return;this.handleFlushFailure(e,r,p);return}if(this.destroyed)return;let S=Gn(h);if(d=S.find((p)=>p.id===r.messageId)??null,!d){if(!On(h,S.length,50)){this.deleteIfSameRevision(e,r.revision);return}try{let l=await this.fetchTailPage(o,r.chatId,200);if(this.destroyed)return;let y=Gn(l);if(d=y.find((E)=>E.id===r.messageId)??null,!d&&!On(l,y.length,200)){this.deleteIfSameRevision(e,r.revision);return}}catch(l){if(this.destroyed)return;this.handleFlushFailure(e,r,l);return}if(!d)return}}else if(!d&&i&&i.id===r.messageId&&(typeof i.chat_id!=="string"||i.chat_id===r.chatId))d=i;if(!d)return;let m=this.pending.get(e);if(!m||m.revision!==r.revision)return;if(typeof d.swipe_id!=="number")return;if(d.swipe_id!==r.swipeId){m.lastKnownSwipeId=d.swipe_id;return}let c={...ve(d.extra)?d.extra:{}};if(r.tokenCount!==void 0)c.tokenCount=r.tokenCount;if(r.generationMetrics!==void 0)c.generationMetrics=r.generationMetrics;try{await s(r.chatId,r.messageId,{extra:c})}catch(h){if(this.destroyed)return;this.handleFlushFailure(e,r,h);return}if(this.destroyed)return;this.deleteIfSameRevision(e,r.revision)}handleFlushFailure(e,t,n){let i=this.pending.get(e);if(!i||i.revision!==t.revision)return;if(xi(n)||t.attempts>=Bn.length){this.pending.delete(e);return}let r=Bn[t.attempts]??150;i.attempts=t.attempts+1,this.scheduleRetry(e,r)}deleteIfSameRevision(e,t){let n=this.pending.get(e);if(n&&n.revision===t)this.pending.delete(e)}scheduleRetry(e,t){if(this.destroyed||this.retryTimers.has(e))return;let n=setTimeout(()=>{if(this.retryTimers.delete(e),this.destroyed)return;this.enqueueFlush(e)},t);this.retryTimers.set(e,n)}clearRetryTimer(e){let t=this.retryTimers.get(e);if(t!==void 0)clearTimeout(t),this.retryTimers.delete(e)}resolveGetMessages(){try{let e=this.ctx.domain?.chats;if(typeof e?.getMessages==="function")return e.getMessages.bind(e);let t=this.ctx.chats;if(typeof t?.getMessages==="function")return t.getMessages.bind(t)}catch{}return null}resolveGetSingleMessage(){try{let e=this.ctx.messages;if(typeof e?.get==="function")return e.get.bind(e)}catch{}return null}resolveUpdateMessage(){try{let e=this.ctx.chats;if(typeof e?.updateMessage==="function")return e.updateMessage.bind(e)}catch{}return null}safeGetActiveChatId(){try{return this.ctx.getActiveChat?.().chatId??null}catch{return null}}}function wi(e){let t=e.length,n=e.trim(),i=n?n.split(/\s+/).length:0;return`${t} ${t===1?"char":"chars"} · ${i} ${i===1?"word":"words"}`}function Ei(e){let t=document.createElement("div");t.className="gg-modal-backdrop",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.setAttribute("aria-label",e);let n=document.createElement("div");n.className="gg-modal-dialog";let i=document.createElement("div");i.className="gg-modal-header";let r=document.createElement("h3");r.className="gg-modal-title",r.textContent=e;let s=document.createElement("button");s.type="button",s.className="gg-icon-btn-sm",s.setAttribute("aria-label","Close modal"),s.textContent="×",i.append(r,s);let d=document.createElement("div");if(d.className="gg-modal-content",n.append(i,d),t.append(n),typeof document<"u"&&document.body)document.body.append(t);let u=!1,o=new Set,m=(h)=>{if(h.key==="Escape"){h.preventDefault(),h.stopPropagation(),c();return}if(h.key==="Tab"){let S=Array.from(n.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter((E)=>E.style.display!=="none");if(S.length===0)return;let p=S[0],l=S[S.length-1],y=document.activeElement;if(h.shiftKey){if(!y||y===p||!n.contains(y))h.preventDefault(),l.focus()}else if(!y||y===l||!n.contains(y))h.preventDefault(),p.focus()}},c=()=>{if(u)return;if(u=!0,typeof document<"u")document.removeEventListener("keydown",m,!0);t.remove();for(let h of[...o])try{h()}catch{}o.clear()};if(s.addEventListener("click",c),t.addEventListener("click",(h)=>{if(h.target===t)c()}),typeof document<"u")document.addEventListener("keydown",m,!0);return{root:d,modalId:"gg-fallback-expandable-modal",dismiss:c,setTitle:(h)=>{r.textContent=h,t.setAttribute("aria-label",h)},onDismiss:(h)=>(o.add(h),()=>o.delete(h))}}function bt(e,t,n){let i=n.value??"",r=n.placeholder??"",s=Boolean(n.disabled),d=null,u=null,o=null,m=!1,c=document.createElement("div");c.className="gg-expandable-ta";let h=document.createElement("div");h.className="gg-expandable-ta-slot";let S=document.createElement("button");S.type="button",S.className="gg-ta-expand-btn",S.setAttribute("aria-label",`Expand ${n.expandTitle}`),S.title=`Expand ${n.expandTitle}`,S.disabled=s,S.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',c.append(h,S),t.replaceChildren(c);let p=null,l=null,y=()=>{if(l)return l;return h.querySelector("textarea")},E=()=>{let v=y();if(!v)return;if(typeof v.selectionStart==="number")d=v.selectionStart,u=typeof v.selectionEnd==="number"?v.selectionEnd:v.selectionStart},w=()=>{if(!o)return;o.countsEl.textContent=wi(i);let v=n.getStatusBadge?.()??null;if(v&&v.text)o.statusRow.style.display="",o.statusBadge.className=v.className,o.statusBadge.textContent=v.text;else o.statusRow.style.display="none",o.statusBadge.textContent="";let A=n.getExtraActions?.()??[],G=new Set;for(let _ of A){G.add(_.id);let O=o.extraActionButtons.get(_.id);if(!O){let C=document.createElement("button");C.type="button",C.className="gg-btn-sm",C.dataset.ggExpandedAction=_.id;let N={btn:C,onClick:_.onClick};C.addEventListener("click",()=>{N.onClick()}),o.extraActionButtons.set(_.id,N),o.extraActionsHost.append(C),O=N}else O.onClick=_.onClick;if(O.btn.style.display=_.hidden?"none":"",O.btn.disabled=Boolean(_.disabled),_.html!==void 0){if(O.lastHtml!==_.html)O.btn.innerHTML=_.html,O.lastHtml=_.html,O.lastLabel=void 0}else if(O.lastLabel!==_.label||O.lastHtml!==void 0)O.btn.textContent=_.label,O.lastLabel=_.label,O.lastHtml=void 0}for(let[_,O]of[...o.extraActionButtons.entries()])if(!G.has(_))O.btn.remove(),o.extraActionButtons.delete(_)},H=(v)=>{if(i=v,E(),o&&o.textarea.value!==v)o.textarea.value=v;w(),n.onChange?.(v)};if(typeof e.components?.mountTextArea==="function")p=e.components.mountTextArea(h,{value:i,rows:n.rows,placeholder:n.placeholder,disabled:s,className:n.className,ariaLabel:n.ariaLabel,onChange:H});else{let v=document.createElement("textarea");if(v.className=n.className?`gg-expandable-ta-fallback ${n.className}`:"gg-expandable-ta-fallback",n.rows!==void 0)v.rows=n.rows;if(n.placeholder!==void 0)v.placeholder=n.placeholder;if(v.disabled=s,n.ariaLabel)v.setAttribute("aria-label",n.ariaLabel);v.value=i,v.addEventListener("input",()=>{H(v.value)}),l=v,h.replaceChildren(v)}let M=()=>E();h.addEventListener("keyup",M,!0),h.addEventListener("mouseup",M,!0),h.addEventListener("select",M,!0);let x=()=>{E()};S.addEventListener("pointerdown",x),S.addEventListener("mousedown",x);let B=()=>{let v=o;if(!v)return;o=null,v.removeEscapeListener();try{v.unsubDismiss()}catch{}try{v.handle.dismiss()}catch{}n.onModalStateChange?.(!1)},T=()=>{if(m||s)return;if(o){o.textarea.focus();return}i=p?p.getValue():l?.value??i;let A=typeof e.ui?.showModal==="function"?e.ui.showModal({title:n.expandTitle,width:860,maxHeight:720}):Ei(n.expandTitle),G=document.createElement("div");G.className="gg-expanded-editor";let _=document.createElement("div");_.className="gg-expanded-editor-status",_.style.display="none";let O=document.createElement("span");O.className="gg-badge",O.dataset.ggExpandedStatus="badge",_.append(O);let C=document.createElement("textarea");C.className="gg-expanded-editor-ta",C.rows=16,C.placeholder=r,C.disabled=s,C.value=i,C.setAttribute("aria-label",n.expandTitle),C.dataset.ggExpandedEditor="true",C.addEventListener("input",()=>{let X=C.value;if(i=X,typeof C.selectionStart==="number")d=C.selectionStart,u=typeof C.selectionEnd==="number"?C.selectionEnd:C.selectionStart;if(p){if(p.getValue()!==X)p.update({value:X})}else if(l&&l.value!==X)l.value=X;w(),n.onChange?.(X)});let N=document.createElement("div");N.className="gg-expanded-editor-footer";let k=document.createElement("div");k.className="gg-expanded-editor-footer-left";let z=document.createElement("span");z.className="gg-muted gg-expanded-editor-counts",z.dataset.ggExpandedCounts="true";let ee=document.createElement("div");ee.className="gg-expanded-editor-actions",k.append(ee,z);let j=document.createElement("button");j.type="button",j.className="gg-btn-sm is-primary",j.dataset.ggExpandedAction="done",j.textContent="Done",j.addEventListener("click",()=>{if(typeof C.selectionStart==="number")d=C.selectionStart,u=typeof C.selectionEnd==="number"?C.selectionEnd:C.selectionStart;A.dismiss()}),N.append(k,j),G.append(_,C,N),A.root.replaceChildren(G);let oe=(X)=>{if(X.key!=="Escape")return;if(o?.handle!==A)return;if(X.preventDefault(),X.stopPropagation(),typeof C.selectionStart==="number")d=C.selectionStart,u=typeof C.selectionEnd==="number"?C.selectionEnd:C.selectionStart;A.dismiss()};if(typeof document<"u")document.addEventListener("keydown",oe,!0);let pe=()=>{if(typeof document<"u")document.removeEventListener("keydown",oe,!0)},ce=A.onDismiss(()=>{if(pe(),o?.handle===A){if(typeof C.selectionStart==="number")d=C.selectionStart,u=typeof C.selectionEnd==="number"?C.selectionEnd:C.selectionStart;if(o=null,n.onModalStateChange?.(!1),!m&&h.isConnected){let X=y();if(X&&!X.disabled){if(X.focus(),d!==null){let ge=Math.min(d,X.value.length),_e=u!==null?Math.min(u,X.value.length):ge;try{X.setSelectionRange(ge,_e)}catch{}}}}}});if(o={handle:A,unsubDismiss:ce,removeEscapeListener:pe,textarea:C,statusRow:_,statusBadge:O,countsEl:z,extraActionsHost:ee,extraActionButtons:new Map},w(),n.onModalStateChange?.(!0),C.focus(),d!==null){let X=Math.min(d,C.value.length),ge=u!==null?Math.min(u,C.value.length):X;try{C.setSelectionRange(X,ge)}catch{}}};return S.addEventListener("click",(v)=>{v.preventDefault(),v.stopPropagation(),T()}),{getValue:()=>{if(o)return o.textarea.value;if(p)return p.getValue();return l?.value??i},update(v){if(m)return;if(v.value!==void 0)i=v.value;if(v.placeholder!==void 0)r=v.placeholder;if(v.disabled!==void 0)s=Boolean(v.disabled),S.disabled=s;if(p)p.update(v);else if(l){if(v.value!==void 0&&l.value!==v.value)l.value=v.value;if(v.placeholder!==void 0)l.placeholder=v.placeholder;if(v.disabled!==void 0)l.disabled=Boolean(v.disabled);if(v.rows!==void 0)l.rows=v.rows}if(o){if(v.value!==void 0&&o.textarea.value!==v.value)o.textarea.value=v.value;if(v.placeholder!==void 0)o.textarea.placeholder=v.placeholder;if(v.disabled!==void 0)o.textarea.disabled=Boolean(v.disabled);w()}},focus(){if(m)return;if(o)o.textarea.focus();else if(p&&typeof p.focus==="function")p.focus();else y()?.focus()},blur(){if(m)return;if(o)o.textarea.blur();else if(p&&typeof p.blur==="function")p.blur();else y()?.blur()},isFocused(){let v=typeof document<"u"?document.activeElement:null;if(!v)return!1;if(o&&v===o.textarea)return!0;if(l&&v===l)return!0;return h.contains(v)},isModalOpen(){return o!==null},openModal:T,dismissModal:B,syncChrome(){w()},destroy(){if(m)return;m=!0,B(),h.removeEventListener("keyup",M,!0),h.removeEventListener("mouseup",M,!0),h.removeEventListener("select",M,!0),S.removeEventListener("pointerdown",x),S.removeEventListener("mousedown",x),p?.destroy(),p=null,l=null,c.remove()}}}var kt="__gg_custom_empty__",Ii=[{value:"drop_now",label:"Drop Now",sublabel:"Insert scene immediately"},{value:"next_turn",label:"Next Turn",sublabel:"Bridge & drop on next turn"},{value:"multi_turn",label:"Multi-Turn",sublabel:"Steer across turns until ready"}],Ci=[{value:"cut",label:"Hard Cut",sublabel:"Jump directly into the scene"},{value:"time_skip",label:"Time Skip",sublabel:"Brief time-skip lead-in"},{value:"bridge",label:"In-Scene Bridge",sublabel:"Smooth narrative bridge"}],Ti=[{value:"verbatim",label:"Verbatim",sublabel:"Use text as-is"},{value:"context_adapt",label:"Context Adapt",sublabel:"Adapt details to chat history"},{value:"summary_rewrite",label:"Summary Rewrite",sublabel:"Rewrite around current arc"}];function Ai(e){return[{value:"new_message",label:"New Message"},{value:"new_swipe",label:"New Swipe",disabled:!e,sublabel:e?"Swipe on last assistant message":"Last message is not assistant"}]}function Ri(e,t=56){let n=e.replace(/\s+/g," ").trim();if(!n)return"(empty)";return n.length>t?`${n.slice(0,t-1)}…`:n}function Mi(e){let t=e.greetings.map((n)=>{let i=e.isGroup?`${n.characterName} · Greeting #${n.greetingIndex+1}`:`Greeting #${n.greetingIndex+1}`,r=[];if(n.isOpening)r.push("Opened chat");if(n.hasMedia)r.push("Media");return r.push(n.preview||Ri(n.text,52)),{value:n.key,label:i,sublabel:r.join(" · "),...e.isGroup?{group:n.characterName}:{}}});return t.push({value:kt,label:"Custom",sublabel:"Write or paste a custom scene in the preview box"}),t}function _i(e){return e.members.map((t)=>({value:t.id,label:t.name}))}function ki(e,t){if(e.greetingLabel?.trim())return e.greetingLabel.trim();if(e.greetingSource==="custom")return"Custom Scene";let n=t?.greetings.find((i)=>i.key===e.selectedGreetingKey);if(n)return t?.isGroup?`${n.characterName} #${n.greetingIndex+1}`:`Greeting #${n.greetingIndex+1}`;return"Greeting"}function yt(e,t){let n=document.createElement("div");n.className=t?`gg-field ${t}`:"gg-field";let i=document.createElement("span");i.className="gg-scene-compact-label",i.textContent=e;let r=document.createElement("div");return n.append(i,r),{wrap:n,slot:r}}class tn{ctx;callbacks;root;context=null;settings=null;activeRun=null;isOtherBusy=!1;loading=!1;busyChatIds=new Set;previewBusy=!1;previewSeq=0;localError=null;destroyed=!1;hydratedChatId=null;hydratedArmedAt=null;greetingSource="card";selectedGreetingKey="";customText="";speakerCharacterId=null;pacing="drop_now";dropTarget="new_message";delivery="time_skip";transitionNote="";adjustmentMode="verbatim";customDirection="";keepMediaIntact=!0;previewText="";draftLocked=!1;bannerEl;bannerTitleText;bannerBadgeEl;bannerPauseBtn;bannerDropNextBtn;bannerDropNowBtn;bannerCancelBtn;errorEl;emptyEl;emptyTextEl;workbenchEl;greetingSelectSlot;greetingSelectHandle=null;lastGreetingOptionsSig="";greetingBadgesEl;speakerRowEl;speakerSelectSlot;speakerSelectHandle=null;lastSpeakerOptionsSig="";pacingSelectSlot;pacingSelectHandle=null;deliverySelectSlot;deliverySelectHandle=null;adjustmentFieldWrap;adjustmentSelectSlot;adjustmentSelectHandle=null;dropTargetFieldWrap;dropTargetSelectSlot;dropTargetSelectHandle=null;lastDropTargetCanSwipe=null;transitionNoteInput;customDirectionRowEl;customDirectionInput;keepMediaCheckbox;previewStatusBadge;previewDraftBtn;previewResetBtn;previewSlot;previewTextAreaHandle=null;lastPreviewPlaceholder="";lastPreviewDisabled=!1;primaryBtn;stopBtn;refreshBtn;constructor(e,t){this.ctx=e;this.callbacks=t;this.root=document.createElement("div"),this.root.className="gg-scene-panel",this.bannerEl=document.createElement("div"),this.bannerEl.className="gg-armed-banner",this.bannerEl.style.display="none",this.bannerEl.setAttribute("role","status"),this.bannerEl.setAttribute("aria-live","polite");let n=document.createElement("div");n.className="gg-armed-banner-top";let i=document.createElement("span");i.className="gg-armed-banner-title";let r=document.createElement("span");r.className="gg-armed-dot",r.setAttribute("aria-hidden","true"),this.bannerTitleText=document.createElement("span"),i.append(r,this.bannerTitleText),this.bannerBadgeEl=document.createElement("span"),this.bannerBadgeEl.className="gg-badge is-info",n.append(i,this.bannerBadgeEl);let s=document.createElement("div");s.className="gg-armed-banner-actions",this.bannerPauseBtn=document.createElement("button"),this.bannerPauseBtn.type="button",this.bannerPauseBtn.className="gg-btn-sm is-xs",this.bannerPauseBtn.dataset.ggSceneBanner="toggle-pause",this.bannerPauseBtn.textContent="Pause",this.bannerPauseBtn.addEventListener("click",()=>{this.handleTogglePause()}),this.bannerDropNextBtn=document.createElement("button"),this.bannerDropNextBtn.type="button",this.bannerDropNextBtn.className="gg-btn-sm is-xs",this.bannerDropNextBtn.dataset.ggSceneBanner="drop-next",this.bannerDropNextBtn.textContent="Drop Next",this.bannerDropNextBtn.addEventListener("click",()=>{this.handleDropNextTurn()}),this.bannerDropNowBtn=document.createElement("button"),this.bannerDropNowBtn.type="button",this.bannerDropNowBtn.className="gg-btn-sm is-xs is-primary",this.bannerDropNowBtn.dataset.ggSceneBanner="drop-now",this.bannerDropNowBtn.textContent="Drop Now",this.bannerDropNowBtn.addEventListener("click",()=>{this.handleBannerDropNow()}),this.bannerCancelBtn=document.createElement("button"),this.bannerCancelBtn.type="button",this.bannerCancelBtn.className="gg-btn-sm is-xs is-danger",this.bannerCancelBtn.dataset.ggSceneBanner="cancel",this.bannerCancelBtn.textContent="Cancel",this.bannerCancelBtn.addEventListener("click",()=>{this.handleCancelSteering()}),s.append(this.bannerPauseBtn,this.bannerDropNextBtn,this.bannerDropNowBtn,this.bannerCancelBtn),this.bannerEl.append(n,s),this.errorEl=document.createElement("div"),this.errorEl.className="gg-notice is-error",this.errorEl.setAttribute("role","alert"),this.emptyEl=document.createElement("div"),this.emptyEl.className="gg-scene-empty";let d=document.createElement("div");d.className="gg-scene-empty-icon",d.setAttribute("aria-hidden","true"),d.innerHTML=tt.scene,this.emptyTextEl=document.createElement("div"),this.emptyTextEl.textContent="Open a character or group chat to stage or steer a Guided Scene.",this.emptyEl.append(d,this.emptyTextEl),this.workbenchEl=document.createElement("div"),this.workbenchEl.className="gg-drawer-view",this.workbenchEl.style.display="none";let u=document.createElement("section");u.className="gg-section",u.dataset.ggSceneSection="greeting";let o=document.createElement("div");o.className="gg-section-title";let m=document.createElement("div");m.className="gg-scene-header-badges";let c=document.createElement("span");c.textContent="Greeting",this.greetingBadgesEl=document.createElement("div"),this.greetingBadgesEl.className="gg-scene-header-badges",m.append(c,this.greetingBadgesEl),this.refreshBtn=document.createElement("button"),this.refreshBtn.type="button",this.refreshBtn.className="gg-btn-sm is-xs",this.refreshBtn.dataset.ggSceneAction="refresh",this.refreshBtn.textContent="Refresh",this.refreshBtn.addEventListener("click",()=>{this.callbacks.onRefreshContext()}),o.append(m,this.refreshBtn),this.greetingSelectSlot=document.createElement("div");let h=yt("Speaker");this.speakerRowEl=h.wrap,this.speakerRowEl.style.display="none",this.speakerSelectSlot=h.slot,u.append(o,this.greetingSelectSlot,this.speakerRowEl);let S=document.createElement("section");S.className="gg-section",S.dataset.ggSceneSection="options";let p=document.createElement("div");p.className="gg-scene-grid-2";let l=yt("Pacing");this.pacingSelectSlot=l.slot;let y=yt("Delivery");this.deliverySelectSlot=y.slot;let E=yt("Adjustment");this.adjustmentFieldWrap=E.wrap,this.adjustmentSelectSlot=E.slot;let w=yt("Drop As");this.dropTargetFieldWrap=w.wrap,this.dropTargetSelectSlot=w.slot,p.append(l.wrap,y.wrap,E.wrap,w.wrap),this.transitionNoteInput=document.createElement("input"),this.transitionNoteInput.type="text",this.transitionNoteInput.className="gg-input-sm",this.transitionNoteInput.placeholder="Transition note (optional)",this.transitionNoteInput.setAttribute("aria-label","Transition note"),this.transitionNoteInput.dataset.ggSceneField="transition-note",this.transitionNoteInput.addEventListener("input",()=>{this.transitionNote=this.transitionNoteInput.value}),this.customDirectionRowEl=document.createElement("div"),this.customDirectionRowEl.className="gg-field",this.customDirectionInput=document.createElement("input"),this.customDirectionInput.type="text",this.customDirectionInput.className="gg-input-sm",this.customDirectionInput.placeholder="Custom direction (optional)",this.customDirectionInput.setAttribute("aria-label","Custom direction"),this.customDirectionInput.dataset.ggSceneField="custom-direction",this.customDirectionInput.addEventListener("input",()=>{this.customDirection=this.customDirectionInput.value}),this.customDirectionRowEl.append(this.customDirectionInput),S.append(p,this.transitionNoteInput,this.customDirectionRowEl);let H=document.createElement("section");H.className="gg-section",H.dataset.ggSceneSection="preview";let M=document.createElement("div");M.className="gg-checkbox-row is-compact";let x=document.createElement("label");x.className="gg-checkbox-label",this.keepMediaCheckbox=document.createElement("input"),this.keepMediaCheckbox.type="checkbox",this.keepMediaCheckbox.className="gg-checkbox",this.keepMediaCheckbox.checked=this.keepMediaIntact,this.keepMediaCheckbox.setAttribute("aria-label","Keep media intact in Guided Scene"),this.keepMediaCheckbox.addEventListener("change",()=>{this.keepMediaIntact=this.keepMediaCheckbox.checked,this.callbacks.onSaveSceneConfigPatch({keepMediaIntact:this.keepMediaIntact})});let B=document.createElement("span");B.textContent="Keep media intact",x.append(this.keepMediaCheckbox,B),M.append(x);let T=document.createElement("div");T.className="gg-scene-preview-bar";let I=document.createElement("div");I.className="gg-scene-preview-title-group";let v=document.createElement("span");v.className="gg-field-label",v.textContent="Staging Preview",this.previewStatusBadge=document.createElement("span"),this.previewStatusBadge.className="gg-badge",this.previewStatusBadge.dataset.ggSceneStatus="preview",I.append(v,this.previewStatusBadge);let A=document.createElement("div");A.className="gg-scene-preview-actions",this.previewDraftBtn=document.createElement("button"),this.previewDraftBtn.type="button",this.previewDraftBtn.className="gg-btn-sm is-xs",this.previewDraftBtn.dataset.ggSceneAction="preview-draft",this.previewDraftBtn.textContent="Preview Draft",this.previewDraftBtn.addEventListener("click",()=>{this.handlePreviewDraft()}),this.previewResetBtn=document.createElement("button"),this.previewResetBtn.type="button",this.previewResetBtn.className="gg-btn-sm is-xs",this.previewResetBtn.dataset.ggSceneAction="reset-preview",this.previewResetBtn.textContent="Reset",this.previewResetBtn.addEventListener("click",()=>{this.handleResetPreview()}),A.append(this.previewDraftBtn,this.previewResetBtn),T.append(I,A),this.previewSlot=document.createElement("div"),this.previewSlot.dataset.ggSceneField="preview-slot",H.append(M,T,this.previewSlot);let G=document.createElement("div");G.className="gg-scene-footer",this.primaryBtn=document.createElement("button"),this.primaryBtn.type="button",this.primaryBtn.className="gg-scene-primary-btn",this.primaryBtn.dataset.ggSceneAction="primary",this.primaryBtn.addEventListener("click",()=>{this.handlePrimaryAction()}),this.stopBtn=document.createElement("button"),this.stopBtn.type="button",this.stopBtn.className="gg-scene-stop-btn",this.stopBtn.dataset.ggSceneAction="stop",this.stopBtn.textContent="Stop Guided Scene",this.stopBtn.style.display="none",this.stopBtn.addEventListener("click",()=>{if(this.activeRun?.actionId==="guided_scene")this.callbacks.onAbortRun(this.activeRun.runId)}),G.append(this.primaryBtn,this.stopBtn),this.workbenchEl.append(u,S,H,G),this.root.append(this.bannerEl,this.emptyEl,this.workbenchEl),this.mountOptionSelects(),this.mountPreviewTextArea()}mountPreviewTextArea(){this.lastPreviewPlaceholder="Select a greeting to stage…",this.lastPreviewDisabled=!1,this.previewTextAreaHandle=bt(this.ctx,this.previewSlot,{value:this.previewText,rows:5,placeholder:"Select a greeting to stage…",ariaLabel:"Scene staging preview",className:"gg-scene-preview-ta",disabled:!1,expandTitle:"Staging Preview",onChange:(t)=>{this.applyPreviewInput(t)},getStatusBadge:()=>({text:this.previewStatusBadge.textContent??"",className:this.previewStatusBadge.className}),getExtraActions:()=>{let t=this.adjustmentMode!=="verbatim",n=this.getEffectiveSourceText().trim().length>0,i=this.activeRun?.actionId==="guided_scene",r=this.isActionBusyFor(),s=!n||r||i||this.isOtherBusy,d=t?"Unlock dynamic adapt":"Reset";return[{id:"preview-draft",label:"Preview Draft",...this.previewBusy?{html:'<span class="gg-spinner" aria-hidden="true"></span><span>Cancel Preview</span>'}:{},disabled:this.previewBusy?!1:s,hidden:!t,onClick:()=>{this.handlePreviewDraft()}},{id:"reset-preview",label:d,disabled:this.previewBusy||r,hidden:!this.draftLocked,onClick:()=>{this.handleResetPreview()}}]}})}mountOptionSelects(){if(typeof this.ctx.components?.mountSelect!=="function")return;this.pacingSelectHandle=this.ctx.components.mountSelect(this.pacingSelectSlot,{options:Ii,value:this.pacing,ariaLabel:"Scene Pacing",onChange:(e)=>{let t=ht(e);if(t===this.pacing)return;this.pacing=t,this.syncUi(),this.callbacks.onSaveSceneConfigPatch({pacing:t})}}),this.deliverySelectHandle=this.ctx.components.mountSelect(this.deliverySelectSlot,{options:Ci,value:this.delivery,ariaLabel:"Scene Delivery",onChange:(e)=>{let t=Qe(e);if(t===this.delivery)return;this.delivery=t,this.syncUi(),this.callbacks.onSaveSceneConfigPatch({delivery:t})}}),this.adjustmentSelectHandle=this.ctx.components.mountSelect(this.adjustmentSelectSlot,{options:Ti,value:this.adjustmentMode,ariaLabel:"Scene Final Adjustment",onChange:(e)=>{let t=et(e);if(t===this.adjustmentMode)return;if(this.adjustmentMode=t,t==="verbatim"&&!this.draftLocked)this.syncPreviewFromSource(!0);this.syncUi(),this.callbacks.onSaveSceneConfigPatch({adjustmentMode:t})}})}syncDropTargetSelect(e){if(typeof this.ctx.components?.mountSelect!=="function")return;if(!e&&this.dropTarget==="new_swipe")this.dropTarget="new_message";let t=Ai(e);if(!this.dropTargetSelectHandle){this.lastDropTargetCanSwipe=e,this.dropTargetSelectHandle=this.ctx.components.mountSelect(this.dropTargetSelectSlot,{options:t,value:this.dropTarget,ariaLabel:"Scene Drop Target",onChange:(n)=>{let i=gt(n);if(i==="new_swipe"&&this.context?.canSwipeLastAssistant===!1){this.dropTarget="new_message",this.dropTargetSelectHandle?.update({value:"new_message"});return}if(i===this.dropTarget)return;this.dropTarget=i,this.syncUi(),this.callbacks.onSaveSceneConfigPatch({dropTarget:i})}});return}if(this.lastDropTargetCanSwipe!==e)this.lastDropTargetCanSwipe=e,this.dropTargetSelectHandle.update({options:t,value:this.dropTarget});else this.dropTargetSelectHandle.update({value:this.dropTarget})}applyPreviewInput(e){if(this.greetingSource==="custom")if(this.draftLocked)this.previewText=e;else this.customText=e,this.previewText=e;else{this.previewText=e;let t=this.getSelectedGreeting()?.text??"";this.draftLocked=this.adjustmentMode!=="verbatim"?!0:e!==t}this.syncPreviewStatusAndButtons(),this.syncPrimaryFooter()}isActionBusyFor(e=this.context?.chatId){return Boolean(e&&this.busyChatIds.has(e))}getElement(){return this.root}setLoading(e){if(this.destroyed)return;this.loading=e,this.syncUi()}setSettings(e){if(this.destroyed)return;this.settings=e;let t=e.guidedScene;if(t){if(!this.context?.armedScene){if(this.keepMediaIntact=Boolean(t.keepMediaIntact),this.keepMediaCheckbox.checked=this.keepMediaIntact,this.hydratedChatId===null)this.pacing=ht(t.pacing),this.delivery=Qe(t.delivery),this.adjustmentMode=et(t.adjustmentMode),this.dropTarget=gt(t.dropTarget)}}this.syncUi()}setActiveRun(e,t=!1){if(this.destroyed)return;this.activeRun=e,this.isOtherBusy=t||Boolean(e&&e.actionId!=="guided_scene"),this.syncUi()}setArmedState(e,t){if(this.destroyed||!this.context||this.context.chatId!==e)return;let n=this.context.armedScene?.armedAt??null;if(this.context={...this.context,armedScene:t},t&&!this.isEditingField())if(t.armedAt!==n)this.hydrateFromArmed(t);else this.pacing=t.pacing;else if(!t)this.hydratedArmedAt=null;this.syncUi()}setContext(e,t){if(this.destroyed)return;this.loading=!1,this.localError=t?.error??null;let n=this.hydratedChatId,i=e?.chatId??null;if(this.context=e,!e||!i){this.previewTextAreaHandle?.dismissModal(),this.previewBusy=!1,this.previewSeq+=1,this.hydratedChatId=null,this.hydratedArmedAt=null,this.syncUi();return}if(n!==i)this.previewTextAreaHandle?.dismissModal(),this.hydratedChatId=i,this.hydratedArmedAt=null,this.previewBusy=!1,this.previewSeq+=1,this.hydrateForChat(e);else if(e.armedScene&&e.armedScene.armedAt!==this.hydratedArmedAt&&!this.isEditingField())this.hydrateFromArmed(e.armedScene);else if(this.greetingSource==="card"&&!e.greetings.some((s)=>s.key===this.selectedGreetingKey))if(e.greetings.length>0){if(this.selectedGreetingKey=this.pickDefaultGreetingKey(e),!this.draftLocked)this.syncPreviewFromSelectedGreeting()}else this.greetingSource="custom",this.selectedGreetingKey="";this.syncUi()}hydrateForChat(e){if(e.armedScene){this.hydrateFromArmed(e.armedScene);return}let t=this.settings?.guidedScene;this.pacing=ht(t?.pacing,"drop_now"),this.delivery=Qe(t?.delivery,"time_skip"),this.adjustmentMode=et(t?.adjustmentMode,"verbatim"),this.dropTarget=gt(t?.dropTarget,"new_message"),this.keepMediaIntact=Boolean(t?.keepMediaIntact??!0),this.greetingSource=e.greetings.length>0?"card":"custom",this.selectedGreetingKey=this.pickDefaultGreetingKey(e);let n=this.getSelectedGreeting();this.customText="",this.speakerCharacterId=n?.characterId??e.members[0]?.id??e.primaryCharacterId??null,this.transitionNote="",this.customDirection="",this.draftLocked=!1,this.previewText=n?.text??"",this.syncInputValuesIfUnfocused(!0)}hydrateFromArmed(e){if(this.hydratedArmedAt=e.armedAt,this.greetingSource=e.greetingSource==="custom"?"custom":"card",this.greetingSource==="card"&&this.context){let t=this.context.greetings.find((n)=>n.key===e.selectedGreetingKey);this.selectedGreetingKey=t?.key??this.pickDefaultGreetingKey(this.context)}else this.selectedGreetingKey="";this.customText=this.greetingSource==="custom"?e.rawGreetingText??"":"",this.speakerCharacterId=e.speakerCharacterId??this.context?.primaryCharacterId??null,this.pacing=e.pacing,this.delivery=Qe(e.delivery,"time_skip"),this.transitionNote=e.transitionNote??"",this.adjustmentMode=et(e.adjustmentMode,"verbatim"),this.customDirection=e.customDirection??"",this.keepMediaIntact=e.keepMediaIntact??Boolean(this.settings?.guidedScene?.keepMediaIntact??!0),this.draftLocked=Boolean(e.draftLocked),this.previewText=e.draftLocked&&e.lockedDraftText?e.lockedDraftText:this.greetingSource==="custom"?this.customText:e.rawGreetingText||this.getSelectedGreeting()?.text||"",this.syncInputValuesIfUnfocused(!1)}pickDefaultGreetingKey(e){if(e.greetings.length===0)return"";return(e.greetings.find((n)=>!n.isOpening)??e.greetings[0]).key}getSelectedGreeting(){if(!this.context||this.context.greetings.length===0)return null;return this.context.greetings.find((e)=>e.key===this.selectedGreetingKey)??this.context.greetings[0]??null}isPreviewFocused(){return Boolean(this.previewTextAreaHandle?.isFocused())}isEditingField(){let e=typeof document<"u"?document.activeElement:null;return this.isPreviewFocused()||Boolean(this.previewTextAreaHandle?.isModalOpen())||e===this.transitionNoteInput||e===this.customDirectionInput}syncInputValuesIfUnfocused(e){let t=typeof document<"u"?document.activeElement:null;if(e||t!==this.transitionNoteInput)this.transitionNoteInput.value=this.transitionNote;if(e||t!==this.customDirectionInput)this.customDirectionInput.value=this.customDirection;this.syncPreviewTextareaValue(this.getDisplayPreviewText(),e)}syncPreviewTextareaValue(e,t=!1){if(!t&&this.isPreviewFocused())return;if(this.previewTextAreaHandle&&this.previewTextAreaHandle.getValue()!==e)this.previewTextAreaHandle.update({value:e})}syncPreviewFromSelectedGreeting(){let e=this.getSelectedGreeting();this.previewText=e?.text??"",this.syncPreviewTextareaValue(this.previewText,!0)}syncPreviewFromSource(e=!1){if(this.greetingSource==="custom")this.previewText=this.customText,this.syncPreviewTextareaValue(this.customText,e);else{let t=this.getSelectedGreeting();this.previewText=t?.text??"",this.syncPreviewTextareaValue(this.previewText,e)}}getDisplayPreviewText(){if(this.draftLocked)return this.previewText;if(this.greetingSource==="custom")return this.customText;return this.getSelectedGreeting()?.text??this.previewText}getEffectiveSourceText(){if(this.greetingSource==="custom")return this.customText;return this.getSelectedGreeting()?.text??""}buildDraftBase(){let e=this.getSelectedGreeting(),t=this.greetingSource==="card",n=this.context?.isGroup?this.speakerCharacterId??e?.characterId??this.context?.primaryCharacterId??null:this.context?.primaryCharacterId??null,i=this.context?.members.find((s)=>s.id===n)?.name??e?.characterName??this.context?.primaryCharacterName??null,r=t?e?this.context?.isGroup?`${e.characterName} · Greeting #${e.greetingIndex+1}`:`Greeting #${e.greetingIndex+1}`:"Greeting":"Custom Scene";return{chatId:this.context?.chatId??null,activeConnectionId:this.callbacks.getActiveConnectionId(),delivery:this.delivery,adjustmentMode:this.adjustmentMode,greetingSource:this.greetingSource,selectedGreetingKey:t?e?.key??null:null,greetingLabel:r,rawGreetingText:t?e?.text??"":this.customText,speakerCharacterId:n,speakerCharacterName:i,transitionNote:this.transitionNote.trim(),customDirection:this.customDirection.trim(),keepMediaIntact:this.keepMediaIntact}}syncUi(){if(this.destroyed)return;if(this.localError){if(this.errorEl.textContent=this.localError,this.errorEl.parentElement!==this.root)this.bannerEl.after(this.errorEl)}else this.errorEl.textContent="",this.errorEl.remove();let e=this.context;if(!e||!e.chatId){this.bannerEl.style.display="none",this.workbenchEl.style.display="none",this.emptyEl.style.display="",this.emptyTextEl.textContent=this.loading?"Loading scene context…":"Open a character or group chat to stage or steer a Guided Scene.";return}this.emptyEl.style.display="none",this.workbenchEl.style.display="";let t=e.armedScene,n=this.activeRun?.actionId==="guided_scene",i=Boolean(e.chatId&&this.busyChatIds.has(e.chatId)),r=i||n||this.isOtherBusy;if(t){let m=t.status==="paused",c=ki(t,e);this.bannerEl.style.display="",this.bannerEl.classList.toggle("is-paused",m),this.bannerTitleText.textContent=m?`Paused · ${c}`:`Steering → ${c}`,this.bannerBadgeEl.className=`gg-badge ${m?"is-warn":"is-info"}`,this.bannerBadgeEl.textContent=t.pacing==="next_turn"?"Next Turn":t.turnsSteered&&t.turnsSteered>0?`Turn ${t.turnsSteered}`:"Multi-Turn",this.bannerPauseBtn.textContent=m?"Resume":"Pause",this.bannerPauseBtn.disabled=r,this.bannerDropNextBtn.disabled=r||!m&&t.pacing==="next_turn",this.bannerDropNowBtn.disabled=r,this.bannerCancelBtn.disabled=r}else this.bannerEl.style.display="none";this.refreshBtn.disabled=this.loading||i,this.syncGreetingSelect(e),this.syncGreetingBadges(),this.syncSpeakerSelect(e),this.pacingSelectHandle?.update({value:this.pacing}),this.deliverySelectHandle?.update({value:this.delivery}),this.adjustmentSelectHandle?.update({value:this.adjustmentMode});let s=this.pacing==="drop_now";this.dropTargetFieldWrap.style.display=s?"":"none",this.adjustmentFieldWrap.classList.toggle("is-span-2",!s);let d=e.canSwipeLastAssistant!==!1;this.syncDropTargetSelect(d),this.customDirectionRowEl.style.display=this.adjustmentMode==="verbatim"?"none":"",this.keepMediaCheckbox.checked=this.keepMediaIntact;let u=this.greetingSource==="custom"?"Write or paste your custom scene opening here…":"Select a greeting to stage…",o=this.previewBusy||i||n;if(u!==this.lastPreviewPlaceholder||o!==this.lastPreviewDisabled)this.lastPreviewPlaceholder=u,this.lastPreviewDisabled=o,this.previewTextAreaHandle?.update({placeholder:u,disabled:o});this.syncPreviewTextareaValue(this.getDisplayPreviewText(),!1),this.syncPreviewStatusAndButtons(),this.syncPrimaryFooter()}syncGreetingSelect(e){let t=Mi(e),n=t.map((r)=>`${r.value}\x00${r.label}\x00${r.sublabel??""}\x00${r.group??""}`).join(`
`),i=this.greetingSource==="custom"?kt:this.selectedGreetingKey||kt;if(!this.greetingSelectHandle&&typeof this.ctx.components?.mountSelect==="function"){this.lastGreetingOptionsSig=n,this.greetingSelectHandle=this.ctx.components.mountSelect(this.greetingSelectSlot,{options:t,value:i,ariaLabel:"Scene Greeting",onChange:(r)=>{if(r===kt){this.greetingSource="custom",this.selectedGreetingKey="",this.customText="",this.previewText="",this.draftLocked=!1,this.syncPreviewTextareaValue("",!0),this.syncUi();return}this.greetingSource="card",this.selectedGreetingKey=r;let s=this.getSelectedGreeting();if(this.context?.isGroup&&s)this.speakerCharacterId=s.characterId,this.speakerSelectHandle?.update({value:s.characterId});this.draftLocked=!1,this.syncPreviewFromSelectedGreeting(),this.syncUi()}});return}if(this.greetingSelectHandle)if(n!==this.lastGreetingOptionsSig)this.lastGreetingOptionsSig=n,this.greetingSelectHandle.update({options:t,value:i});else this.greetingSelectHandle.update({value:i})}syncGreetingBadges(){if(this.greetingBadgesEl.replaceChildren(),this.greetingSource!=="card")return;let e=this.getSelectedGreeting();if(!e)return;if(e.isOpening){let t=document.createElement("span");t.className="gg-badge is-info",t.textContent="Opened chat",this.greetingBadgesEl.append(t)}if(e.hasMedia){let t=document.createElement("span");t.className="gg-badge",t.textContent="Has media",this.greetingBadgesEl.append(t)}}syncSpeakerSelect(e){let t=e.isGroup&&e.members.length>0;if(this.speakerRowEl.style.display=t?"":"none",!t)return;let n=_i(e),i=n.map((s)=>`${s.value}\x00${s.label}`).join(`
`),r=this.speakerCharacterId??e.members[0]?.id??"";if(!this.speakerSelectHandle&&typeof this.ctx.components?.mountSelect==="function"){this.lastSpeakerOptionsSig=i,this.speakerSelectHandle=this.ctx.components.mountSelect(this.speakerSelectSlot,{options:n,value:r,ariaLabel:"Scene Speaker",onChange:(s)=>{this.speakerCharacterId=s||null}});return}if(this.speakerSelectHandle)if(i!==this.lastSpeakerOptionsSig)this.lastSpeakerOptionsSig=i,this.speakerSelectHandle.update({options:n,value:r});else this.speakerSelectHandle.update({value:r})}syncPreviewStatusAndButtons(){let e=this.adjustmentMode!=="verbatim",t=this.getEffectiveSourceText().trim().length>0,n=this.activeRun?.actionId==="guided_scene",i="gg-badge",r="Verbatim";if(!e)i=this.draftLocked?"gg-badge is-info":"gg-badge",r=this.draftLocked?"Edited verbatim":"Verbatim";else if(this.draftLocked)i="gg-badge is-info",r="Locked draft";else if(this.pacing!=="drop_now")i="gg-badge is-success",r="Adapts at drop time";else i="gg-badge",r="Adapts on drop";this.previewStatusBadge.className=i,this.previewStatusBadge.textContent=r;let s=this.isActionBusyFor(),d=!t||s||n||this.isOtherBusy,u=this.draftLocked,o=e?"Unlock dynamic adapt":"Reset",m=this.previewBusy||s;if(this.previewDraftBtn.style.display=e?"":"none",this.previewBusy)this.previewDraftBtn.disabled=!1,this.previewDraftBtn.innerHTML='<span class="gg-spinner" aria-hidden="true"></span><span>Cancel Preview</span>';else this.previewDraftBtn.disabled=d,this.previewDraftBtn.textContent="Preview Draft";this.previewResetBtn.style.display=u?"":"none",this.previewResetBtn.textContent=o,this.previewResetBtn.disabled=m,this.previewTextAreaHandle?.syncChrome()}syncPrimaryFooter(){if(this.activeRun?.actionId==="guided_scene"){this.primaryBtn.style.display="none",this.stopBtn.style.display="";return}this.stopBtn.style.display="none",this.primaryBtn.style.display="";let t=this.context?.armedScene??null;if(this.pacing==="drop_now")this.primaryBtn.textContent="Drop Scene";else if(t)this.primaryBtn.textContent="Update Steering";else if(this.pacing==="next_turn")this.primaryBtn.textContent="Arm Next-Turn";else this.primaryBtn.textContent="Start Steering";let n=this.draftLocked?this.previewText.trim():this.getEffectiveSourceText().trim(),i=this.isActionBusyFor();this.primaryBtn.disabled=!this.context?.chatId||!n||i||this.previewBusy||this.isOtherBusy}async handlePreviewDraft(){let e=this.context?.chatId;if(this.destroyed||!e)return;if(this.previewBusy){this.previewSeq+=1,this.previewBusy=!1,this.syncUi(),this.callbacks.onCancelPreview?.(e);return}let t=++this.previewSeq;this.previewBusy=!0,this.localError=null,this.syncUi();try{let n=await this.callbacks.onPreviewDraft(this.buildDraftBase());if(this.destroyed||t!==this.previewSeq)return;if(this.previewBusy=!1,!n.aborted&&typeof n.text==="string")this.previewText=n.text,this.draftLocked=!0,this.syncPreviewTextareaValue(n.text,!0);this.syncUi()}catch(n){if(this.destroyed||t!==this.previewSeq)return;this.previewBusy=!1,this.localError=n instanceof Error?n.message:String(n),this.syncUi()}}handleResetPreview(){this.draftLocked=!1,this.syncPreviewFromSource(!0),this.syncUi()}async handlePrimaryAction(){let e=this.context?.chatId;if(this.destroyed||!e||this.busyChatIds.has(e))return;this.busyChatIds.add(e),this.localError=null,this.syncUi();try{let t=this.buildDraftBase(),n=this.draftLocked?this.previewText:null;if(this.pacing==="drop_now"){let i=this.context.canSwipeLastAssistant!==!1,r=this.dropTarget==="new_swipe"&&i?"new_swipe":"new_message";await this.callbacks.onDropSceneNow({...t,dropTarget:r,lockedDraftText:n,previewText:n,draftLocked:this.draftLocked})}else if(this.context.armedScene){let i=await this.callbacks.onUpdateArmedScene({...t,pacing:this.pacing,lockedDraftText:n,previewText:n,draftLocked:this.draftLocked});if(!this.destroyed&&this.context?.chatId===e)this.context={...this.context,armedScene:i},this.hydratedArmedAt=i?.armedAt??null}else{let i=await this.callbacks.onArmScene({...t,pacing:this.pacing,lockedDraftText:n,previewText:n,draftLocked:this.draftLocked});if(!this.destroyed&&this.context?.chatId===e)this.context={...this.context,armedScene:i},this.hydratedArmedAt=i?.armedAt??null}}catch(t){if(!this.destroyed&&this.context?.chatId===e)this.localError=t instanceof Error?t.message:String(t)}finally{if(this.busyChatIds.delete(e),!this.destroyed)this.syncUi()}}async handleTogglePause(){let e=this.context?.chatId,t=this.context?.armedScene??null;if(this.destroyed||!e||!t||this.busyChatIds.has(e))return;this.busyChatIds.add(e),this.localError=null,this.syncUi();try{let n=t.status==="paused"?await this.callbacks.onResumeScene(e):await this.callbacks.onPauseScene(e);if(!this.destroyed&&this.context?.chatId===e)this.context={...this.context,armedScene:n}}catch(n){if(!this.destroyed&&this.context?.chatId===e)this.localError=n instanceof Error?n.message:String(n)}finally{if(this.busyChatIds.delete(e),!this.destroyed)this.syncUi()}}async handleDropNextTurn(){let e=this.context?.chatId,t=this.context?.armedScene??null;if(this.destroyed||!e||!t||this.busyChatIds.has(e))return;this.busyChatIds.add(e),this.localError=null,this.syncUi();try{let n=await this.callbacks.onDropNextTurn(e);if(!this.destroyed&&this.context?.chatId===e){if(this.context={...this.context,armedScene:n},n)this.pacing=n.pacing}}catch(n){if(!this.destroyed&&this.context?.chatId===e)this.localError=n instanceof Error?n.message:String(n)}finally{if(this.busyChatIds.delete(e),!this.destroyed)this.syncUi()}}async handleBannerDropNow(){let e=this.context?.chatId,t=this.context?.armedScene??null;if(this.destroyed||!e||!t||this.busyChatIds.has(e))return;this.busyChatIds.add(e),this.localError=null,this.syncUi();try{await this.callbacks.onDropSceneNow({chatId:e,greetingSource:t.greetingSource,selectedGreetingKey:t.selectedGreetingKey??null,greetingLabel:t.greetingLabel,rawGreetingText:t.rawGreetingText,speakerCharacterId:t.speakerCharacterId??null,speakerCharacterName:t.speakerCharacterName??null,delivery:t.delivery,transitionNote:t.transitionNote,adjustmentMode:t.adjustmentMode,customDirection:t.customDirection,keepMediaIntact:t.keepMediaIntact??this.settings?.guidedScene?.keepMediaIntact??!0,draftLocked:t.draftLocked,lockedDraftText:t.lockedDraftText,previewText:t.lockedDraftText??void 0,dropTarget:"new_message",activeConnectionId:this.callbacks.getActiveConnectionId()})}catch(n){if(!this.destroyed&&this.context?.chatId===e)this.localError=n instanceof Error?n.message:String(n)}finally{if(this.busyChatIds.delete(e),!this.destroyed)this.syncUi()}}async handleCancelSteering(){let e=this.context?.chatId;if(this.destroyed||!e||this.busyChatIds.has(e))return;this.busyChatIds.add(e),this.localError=null,this.syncUi();try{if(await this.callbacks.onCancelScene(e),!this.destroyed&&this.context?.chatId===e)this.context={...this.context,armedScene:null},this.hydratedArmedAt=null}catch(t){if(!this.destroyed&&this.context?.chatId===e)this.localError=t instanceof Error?t.message:String(t)}finally{if(this.busyChatIds.delete(e),!this.destroyed)this.syncUi()}}destroy(){if(this.destroyed)return;this.destroyed=!0,this.busyChatIds.clear(),this.previewSeq+=1,this.previewTextAreaHandle?.destroy(),this.previewTextAreaHandle=null,this.greetingSelectHandle?.destroy(),this.greetingSelectHandle=null,this.speakerSelectHandle?.destroy(),this.speakerSelectHandle=null,this.pacingSelectHandle?.destroy(),this.pacingSelectHandle=null,this.deliverySelectHandle?.destroy(),this.deliverySelectHandle=null,this.adjustmentSelectHandle?.destroy(),this.adjustmentSelectHandle=null,this.dropTargetSelectHandle?.destroy(),this.dropTargetSelectHandle=null,this.root.remove()}}var Ge=[{id:"guided_scene",label:"Guided Scene",iconSvg:tt.scene}],Fn=[{value:"system",label:"System"},{value:"user",label:"User"},{value:"assistant",label:"Assistant"}],Pi=ct.map((e)=>({value:e.value,label:e.label,sublabel:e.sublabel})),Li=Ot.map((e)=>({value:e.value,label:e.label,sublabel:e.sublabel})),Di=Cn.map((e)=>({value:e.value,label:e.label,sublabel:e.sublabel})),Ni=Tn.map((e)=>({value:e.value,label:e.label,sublabel:e.sublabel}));class nn{ctx;handlers;tab;handles=[];expandableTextAreas=new Set;currentSettings=null;expandedSections=new Set;debounceTimers=new Map;orderStateTags=new Map;shellEl=null;navEl=null;navButtons=new Map;navArmedDotEl=null;subNavButtons=new Map;subNavArmedDotEl=null;stickyNoticeSlotEl=null;bodyScrollEl=null;basicViewEl=null;advancedViewEl=null;basicHostEl=null;sceneWorkbenchHostEl=null;sceneSettingsHostEl=null;activeTab="basic";activeAdvancedSubTab="guided_scene";scenePanel=null;armedScene=null;sceneContext=null;sceneContextError=null;sceneLoading=!1;sceneActiveRun=null;rootEl=null;noticeEl=null;recoveryUi=null;pendingView=null;pendingFocusRestore=null;pendingGeneralFocusRestore=null;pointerActiveInDrawer=!1;pointerReleaseCleanup=null;pointerFallbackTimer=null;pendingViewFlushTimer=null;tabConnectionCleanups=new Set;noticeText="";noticeKind="info";recoveryBusy=!1;destroyed=!1;onFocusOut;onPointerDownInDrawer;constructor(e,t){this.ctx=e;this.handlers=t;this.tab=e.ui.registerDrawerTab({id:"guided-generations-settings",title:"Guided Generations",shortName:"Guided",description:"Configure input-bar guided action buttons, per-option API profiles & presets, and Guided Scene transitions.",keywords:["guided","scene","greeting","steering","continue","regenerate","swipe","impersonate","recovery","preset","profile"],iconSvg:kn});let n=()=>{if(this.pointerFallbackTimer!==null)clearTimeout(this.pointerFallbackTimer),this.pointerFallbackTimer=null;if(this.pointerReleaseCleanup){let i=this.pointerReleaseCleanup;this.pointerReleaseCleanup=null,i()}};this.onPointerDownInDrawer=()=>{if(this.destroyed||this.pointerActiveInDrawer)return;if(this.pointerActiveInDrawer=!0,n(),typeof document>"u"){this.pointerActiveInDrawer=!1;return}let i=typeof window<"u"?window:document.defaultView,r=()=>{if(n(),this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer);this.pendingViewFlushTimer=setTimeout(()=>{this.pendingViewFlushTimer=null,this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()},0)},s=()=>{n(),this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()};document.addEventListener("pointerup",r,!0),document.addEventListener("pointercancel",r,!0),document.addEventListener("mouseup",r,!0),i?.addEventListener("blur",s),this.pointerReleaseCleanup=()=>{document.removeEventListener("pointerup",r,!0),document.removeEventListener("pointercancel",r,!0),document.removeEventListener("mouseup",r,!0),i?.removeEventListener("blur",s)},this.pointerFallbackTimer=setTimeout(()=>{n(),this.pointerActiveInDrawer=!1,this.flushPendingViewIfIdle()},3000)},this.onFocusOut=(i)=>{if(this.destroyed)return;let r=i.relatedTarget;if(this.debounceTimers.size>0&&r!==i.target)this.flushPendingSaves();if(!(Pt(r)&&this.isInsideSettingsRegions(r)&&Un(r))&&this.pendingView)if(this.pointerActiveInDrawer||Bi(this.tab.root,r)){if(!this.pointerActiveInDrawer)this.scheduleDeferredPendingViewFlush()}else queueMicrotask(()=>{this.flushPendingViewIfIdle()})},this.tab.root.addEventListener("pointerdown",this.onPointerDownInDrawer),this.tab.root.addEventListener("mousedown",this.onPointerDownInDrawer),this.tab.root.addEventListener("focusout",this.onFocusOut)}getTabId(){return this.tab.tabId}activate(){if(this.destroyed)return;try{this.tab.activate?.()}catch{}}getActiveTab(){return this.activeTab}getActiveAdvancedSubTab(){return this.activeAdvancedSubTab}isShowingGuidedScene(){return this.activeTab==="advanced"&&this.activeAdvancedSubTab==="guided_scene"}setActiveTab(e){if(this.destroyed)return;let t=this.activeTab!==e;if(this.activeTab=e,this.shellEl)this.syncActiveViewVisibility();if(e==="advanced"&&this.activeAdvancedSubTab==="guided_scene")this.ensureScenePanelMounted();if(t)this.handlers.onActiveViewChange?.(this.activeTab,this.activeAdvancedSubTab)}setActiveAdvancedSubTab(e){if(this.destroyed)return;let t=this.activeAdvancedSubTab!==e;if(this.activeAdvancedSubTab=e,this.shellEl)this.syncActiveViewVisibility();if(this.activeTab==="advanced"&&e==="guided_scene")this.ensureScenePanelMounted();if(t&&this.activeTab==="advanced")this.handlers.onActiveViewChange?.(this.activeTab,this.activeAdvancedSubTab)}openGuidedScene(){if(this.destroyed)return;let e=this.isShowingGuidedScene();if(this.activeTab="advanced",this.activeAdvancedSubTab="guided_scene",this.ensureShellMounted(),this.syncActiveViewVisibility(),this.ensureScenePanelMounted(),!e)this.handlers.onActiveViewChange?.("advanced","guided_scene")}setArmedScene(e,t){if(this.destroyed)return;this.armedScene=e,this.syncArmedNavDots();let n=t??e?.chatId??this.sceneContext?.chatId??null;if(n)this.scenePanel?.setArmedState(n,e)}setSceneContext(e,t=null){if(this.destroyed)return;if(this.sceneContext=e,this.sceneContextError=t,e&&e.armedScene!==void 0)this.armedScene=e.armedScene??null,this.syncArmedNavDots();this.scenePanel?.setContext(e,{error:t})}setSceneLoading(e){if(this.destroyed)return;this.sceneLoading=e,this.scenePanel?.setLoading(e)}setSceneActiveRun(e,t=!1){if(this.destroyed)return;this.sceneActiveRun=e,this.scenePanel?.setActiveRun(e,t)}syncSettings(e){if(this.destroyed)return;if(this.currentSettings=e,this.pendingView)this.pendingView={...this.pendingView,settings:e};this.scenePanel?.setSettings(e)}ensureShellMounted(){if(this.shellEl&&this.tab.root.contains(this.shellEl))return;let e=document.createElement("div");e.className="gg-drawer-root";let t=document.createElement("nav");t.className="gg-drawer-nav",t.setAttribute("role","tablist"),t.setAttribute("aria-label","Guided Generations Views");let n=["basic","advanced"];this.navButtons.clear();let i=(p,l,y,E=!1)=>{let w=document.createElement("button");w.type="button",w.id=`gg-nav-tab-${p}`,w.className="gg-drawer-nav-btn",w.setAttribute("role","tab"),w.setAttribute("aria-controls",`gg-nav-panel-${p}`),w.setAttribute("data-gg-nav",p),w.dataset.ggFocusKey=`nav:${p}`;let H=document.createElement("span");H.className="gg-nav-icon",H.setAttribute("aria-hidden","true"),H.innerHTML=y;let M=document.createElement("span");if(M.textContent=l,w.append(H,M),E){let x=document.createElement("span");x.className="gg-nav-armed-dot",x.setAttribute("aria-hidden","true"),x.style.display="none",w.append(x),this.navArmedDotEl=x}return w.addEventListener("click",()=>{this.flushPendingSaves(),this.setActiveTab(p)}),this.navButtons.set(p,w),w};t.append(i("basic","Basic",tt.basic,!1),i("advanced","Advanced",tt.advanced,!0)),t.addEventListener("keydown",(p)=>{let l=n.indexOf(this.activeTab),y=-1;if(p.key==="ArrowRight")y=(l+1)%n.length;else if(p.key==="ArrowLeft")y=(l-1+n.length)%n.length;else if(p.key==="Home")y=0;else if(p.key==="End")y=n.length-1;if(y===-1)return;p.preventDefault();let E=n[y];this.flushPendingSaves(),this.setActiveTab(E),this.navButtons.get(E)?.focus()});let r=document.createElement("div");r.className="gg-drawer-sticky-slot";let s=document.createElement("div");s.className="gg-drawer-body";let d=document.createElement("div");d.id="gg-nav-panel-basic",d.className="gg-drawer-view gg-view-basic",d.setAttribute("role","tabpanel"),d.setAttribute("aria-labelledby","gg-nav-tab-basic"),d.setAttribute("data-gg-view","basic");let u=document.createElement("div");d.append(u);let o=document.createElement("div");o.id="gg-nav-panel-advanced",o.className="gg-drawer-view gg-view-advanced",o.setAttribute("role","tabpanel"),o.setAttribute("aria-labelledby","gg-nav-tab-advanced"),o.setAttribute("data-gg-view","advanced");let m=document.createElement("div");m.className="gg-subnav",m.setAttribute("role","tablist"),m.setAttribute("aria-label","Advanced Guided Features"),this.subNavButtons.clear();for(let p of Ge){let l=document.createElement("button");l.type="button",l.id=`gg-subnav-tab-${p.id}`,l.className="gg-subnav-btn",l.setAttribute("role","tab"),l.setAttribute("aria-controls",`gg-subnav-panel-${p.id}`),l.setAttribute("data-gg-subnav",p.id),l.dataset.ggFocusKey=`subnav:${p.id}`;let y=document.createElement("span");y.setAttribute("aria-hidden","true"),y.style.display="inline-flex",y.innerHTML=p.iconSvg;let E=document.createElement("span");if(E.textContent=p.label,l.append(y,E),p.id==="guided_scene"){let w=document.createElement("span");w.className="gg-nav-armed-dot",w.setAttribute("aria-hidden","true"),w.style.display="none",l.append(w),this.subNavArmedDotEl=w}l.addEventListener("click",()=>{this.flushPendingSaves(),this.setActiveAdvancedSubTab(p.id)}),this.subNavButtons.set(p.id,l),m.append(l)}m.addEventListener("keydown",(p)=>{if(Ge.length===0)return;let l=Ge.findIndex((w)=>w.id===this.activeAdvancedSubTab),y=-1;if(p.key==="ArrowRight")y=(l+1)%Ge.length;else if(p.key==="ArrowLeft")y=(l-1+Ge.length)%Ge.length;else if(p.key==="Home")y=0;else if(p.key==="End")y=Ge.length-1;if(y===-1)return;p.preventDefault();let E=Ge[y].id;this.flushPendingSaves(),this.setActiveAdvancedSubTab(E),this.subNavButtons.get(E)?.focus()});let c=document.createElement("div");c.id="gg-subnav-panel-guided_scene",c.className="gg-drawer-view gg-subview-scene",c.setAttribute("role","tabpanel"),c.setAttribute("aria-labelledby","gg-subnav-tab-guided_scene"),c.setAttribute("data-gg-subview","guided_scene");let h=document.createElement("div");h.className="gg-scene-workbench-host";let S=document.createElement("div");if(S.className="gg-scene-settings-host",c.append(h,S),o.append(m,c),s.append(d,o),e.append(t,r,s),this.shellEl=e,this.navEl=t,this.stickyNoticeSlotEl=r,this.bodyScrollEl=s,this.basicViewEl=d,this.advancedViewEl=o,this.basicHostEl=u,this.sceneWorkbenchHostEl=h,this.sceneSettingsHostEl=S,this.tab.root.replaceChildren(e),this.scenePanel)this.sceneWorkbenchHostEl.replaceChildren(this.scenePanel.getElement());this.syncActiveViewVisibility(),this.syncArmedNavDots(),this.syncNoticeElement()}ensureScenePanelMounted(){if(this.destroyed||!this.handlers.scene)return;if(this.ensureShellMounted(),!this.sceneWorkbenchHostEl)return;if(this.scenePanel){if(this.scenePanel.getElement().parentElement!==this.sceneWorkbenchHostEl)this.sceneWorkbenchHostEl.replaceChildren(this.scenePanel.getElement());return}if(this.scenePanel=new tn(this.ctx,this.handlers.scene),this.sceneWorkbenchHostEl.replaceChildren(this.scenePanel.getElement()),this.currentSettings)this.scenePanel.setSettings(this.currentSettings);if(this.scenePanel.setActiveRun(this.sceneActiveRun),this.scenePanel.setLoading(this.sceneLoading),this.sceneContext||this.sceneContextError)this.scenePanel.setContext(this.sceneContext,{error:this.sceneContextError});else if(this.armedScene)this.scenePanel.setArmedState(this.armedScene.chatId,this.armedScene)}syncActiveViewVisibility(){for(let[e,t]of this.navButtons.entries()){let n=e===this.activeTab;t.classList.toggle("is-active",n),t.setAttribute("aria-selected",String(n)),t.tabIndex=n?0:-1}for(let[e,t]of this.subNavButtons.entries()){let n=e===this.activeAdvancedSubTab;t.classList.toggle("is-active",n),t.setAttribute("aria-selected",String(n)),t.tabIndex=n?0:-1}if(this.basicViewEl)this.basicViewEl.classList.toggle("is-hidden",this.activeTab!=="basic");if(this.advancedViewEl)this.advancedViewEl.classList.toggle("is-hidden",this.activeTab!=="advanced")}syncArmedNavDots(){let e=this.armedScene,t=e?.status==="paused",n=(i)=>{if(!i)return;if(!e){i.style.display="none",i.classList.remove("is-paused");return}i.style.display="",i.classList.toggle("is-paused",t)};n(this.navArmedDotEl),n(this.subNavArmedDotEl)}scheduleDeferredPendingViewFlush(){if(this.destroyed||this.pendingViewFlushTimer!==null)return;this.pendingViewFlushTimer=setTimeout(()=>{this.pendingViewFlushTimer=null,this.flushPendingViewIfIdle()},0)}flushPendingViewIfIdle(){if(this.destroyed||this.pointerActiveInDrawer)return;if(this.pendingView&&!this.isEditingDrawerInput()){let e=this.currentSettings?{...this.pendingView,settings:this.currentSettings}:this.pendingView;this.pendingView=null,this.render(e,{force:!0})}}onActivate(e){return this.tab.onActivate(e)}isTabConnected(){if(this.destroyed)return!1;if(this.tab.root?.isConnected)return!0;try{let e=this.ctx.ui?.getTabLocation?.(this.tab.tabId);if(e&&e.kind!=="main-drawer")return!0}catch{}try{let e=this.ctx.ui?.events?.getDrawerState?.();if(e?.open&&e.tabId===this.tab.tabId)return!0}catch{}return!1}observeTabConnection(e){if(this.destroyed||typeof IntersectionObserver!=="function")return()=>{};let t=!0,n=()=>{if(!t)return;t=!1,this.tabConnectionCleanups.delete(n),i.disconnect()},i=new IntersectionObserver((r)=>{if(!t||this.destroyed){n();return}if(r.some((s)=>s.isIntersecting)||this.isTabConnected())n(),e()},{threshold:0});return this.tabConnectionCleanups.add(n),i.observe(this.tab.root),n}setNotice(e,t="info"){this.noticeText=e,this.noticeKind=t,this.syncNoticeElement()}syncNoticeElement(){if(this.destroyed||!this.stickyNoticeSlotEl)return;if(!this.noticeText){this.noticeEl?.remove(),this.noticeEl=null;return}if(!this.noticeEl)this.noticeEl=document.createElement("div"),this.stickyNoticeSlotEl.append(this.noticeEl);if(this.noticeEl.className=`gg-notice${this.noticeKind==="error"?" is-error":this.noticeKind==="warn"?" is-warn":""}`,this.noticeKind==="error"||this.noticeKind==="warn")this.noticeEl.setAttribute("role","alert"),this.noticeEl.setAttribute("aria-live","assertive");else this.noticeEl.setAttribute("role","status"),this.noticeEl.setAttribute("aria-live","polite");this.noticeEl.textContent=this.noticeText}setRecoveryBusy(e){if(this.destroyed)return;if(this.recoveryBusy=e,!this.recoveryUi)return;if(this.recoveryUi.clearBtn.disabled=e||this.recoveryUi.recoveryCount===0,this.recoveryUi.listEl)for(let t of this.recoveryUi.listEl.querySelectorAll("button"))t.disabled=e}updateRecovery(e,t){if(this.destroyed)return;if(this.pendingView)this.pendingView={...this.pendingView,recovery:[...e]};if(!this.recoveryUi)return;let n=t?.inputRecovery.maxEntries??this.currentSettings?.inputRecovery.maxEntries??10;this.recoveryUi.maxEntries=n,this.recoveryUi.recoveryCount=e.length,this.recoveryUi.setBadge(e.length>0?String(e.length):"",e.length===0),this.recoveryUi.countLabel.textContent=e.length>0?`Saved inputs (${e.length}/${n}):`:"No saved inputs yet.",this.recoveryUi.clearBtn.disabled=this.recoveryBusy||e.length===0,this.syncRecoveryList(e)}isInsideSettingsRegions(e){if(!e)return!1;return Boolean(this.basicHostEl&&this.basicHostEl.contains(e)||this.sceneSettingsHostEl&&this.sceneSettingsHostEl.contains(e))}isEditingDrawerInput(){if(this.debounceTimers.size>0)return!0;for(let n of this.expandableTextAreas)if(n.isModalOpen())return!0;let e='[aria-expanded="true"]:not(.gg-card-header):not(.gg-sub-disclosure-btn), [role="listbox"]';if(this.basicHostEl&&this.basicHostEl.querySelector(e)!==null||this.sceneSettingsHostEl&&this.sceneSettingsHostEl.querySelector(e)!==null)return!0;let t=typeof document<"u"?document.activeElement:null;return Boolean(Pt(t)&&this.isInsideSettingsRegions(t)&&Un(t))}captureOrderButtonFocus(){let e=typeof document<"u"?document.activeElement:null;if(!Pt(e)||!this.isInsideSettingsRegions(e))return;if(!this.pendingFocusRestore&&e.tagName==="BUTTON"){let t=e,n=t.dataset.ggMove;if(n==="up"||n==="down"){let r=t.closest("[data-gg-order-id]")?.getAttribute("data-gg-order-id");if(r){this.pendingFocusRestore={optionId:r,button:n};return}}}if(!this.pendingFocusRestore&&!this.pendingGeneralFocusRestore){let t=e.getAttribute("data-gg-focus-key")??void 0,n=e.getAttribute("aria-label")??void 0;if(t||n)this.pendingGeneralFocusRestore={focusKey:t,tagName:e.tagName,ariaLabel:n}}}render(e,t){if(this.destroyed)return;if(!t?.force&&this.rootEl!==null&&this.currentSettings!==null&&this.isEditingDrawerInput()){if(e)this.pendingView=e,this.updateRecovery(e.recovery,e.settings);return}if(this.pendingView=null,this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer),this.pendingViewFlushTimer=null;this.captureOrderButtonFocus();let n=e;if(t?.force&&this.debounceTimers.size>0){if(this.flushPendingSaves(),n&&this.currentSettings)n={...n,settings:this.currentSettings}}else this.cancelPendingSaves();if(this.clearComponentHandles(),this.orderStateTags.clear(),this.recoveryUi=null,this.currentSettings=n?.settings??null,this.ensureShellMounted(),n?.settings)this.scenePanel?.setSettings(n.settings);if(this.isShowingGuidedScene())this.ensureScenePanelMounted();let i=document.createElement("div");i.className="gg-drawer",this.rootEl=i,this.basicHostEl.replaceChildren(i),this.sceneSettingsHostEl.replaceChildren();let r=document.createElement("header");r.className="gg-header";let s=document.createElement("div"),d=document.createElement("h2");d.textContent="Guided Generations";let u=document.createElement("p");u.className="gg-muted",u.textContent="Enabled options appear on the composer action bar. Each option uses its own connection profile, model, and preset without altering your active chat.",s.append(d,u);let o=document.createElement("button");if(o.type="button",o.className="gg-btn-sm",o.dataset.ggFocusKey="refresh",o.textContent="Refresh",o.addEventListener("click",()=>{this.flushPendingSaves(),this.handlers.onRefresh()}),r.append(s,o),i.append(r),this.syncNoticeElement(),!n){let l=document.createElement("p");l.className="gg-muted",l.textContent="Loading Guided Generations settings…",i.append(l),this.restoreCapturedFocus(this.shellEl);return}let m=[];if(!n.permissions.generation)m.push("generation");if(!n.permissions.chats)m.push("chats");if(!n.permissions.chat_mutation)m.push("chat_mutation");if(!n.permissions.presets)m.push("presets");if(m.length>0){let l=document.createElement("div");l.className="gg-notice is-warn",l.setAttribute("role","alert"),l.setAttribute("aria-live","assertive"),l.textContent=`Missing extension permissions (${m.join(", ")}). Grant all permissions in Extension Manager so actions and dropdowns work properly.`,i.append(l)}let c=[],h=[];if(n.permissions.interceptor===!1)c.push("interceptor"),h.push("preset-aware guidance placement (pre-history, in-history, before/after post-history) and swipe turn matching fall back to basic heuristic placement");if(n.permissions.regex_scripts===!1)c.push("regex_scripts"),h.push("Lumiverse regex scripts are skipped on guidance prompts and generated/impersonated outputs");if(c.length>0){let l=document.createElement("div");l.className="gg-notice is-warn",l.setAttribute("role","alert"),l.setAttribute("aria-live","assertive"),l.textContent=`Optional permissions not granted (${c.join(", ")}): ${h.join("; ")}. Grant them in Extension Manager for full functionality.`,i.append(l)}if(n.catalogWarnings&&n.catalogWarnings.length>0){let l=document.createElement("div");l.className="gg-notice is-warn",l.setAttribute("role","alert"),l.setAttribute("aria-live","assertive"),l.textContent=n.catalogWarnings.join(" "),i.append(l)}let S=Fi(n.connections),p=Ui(n.presets);this.renderToolbarLayoutSection(i,n.settings);for(let l of It)this.renderActionSection(i,n.settings,l,n.connections,S,p,Fn);this.renderRecoverySection(i,n.settings,n.recovery),this.renderGuidedSceneSettingsSection(this.sceneSettingsHostEl,n.settings,n.connections,S,p),this.restoreCapturedFocus(this.shellEl)}restoreCapturedFocus(e){if(this.pendingFocusRestore){let t=this.pendingFocusRestore;this.pendingFocusRestore=null,this.pendingGeneralFocusRestore=null;let n=e.querySelector(`[data-gg-order-id="${t.optionId}"]`),i=n?.querySelector(`button[data-gg-move="${t.button}"]`),r=n?.querySelector(`button[data-gg-move="${t.button==="up"?"down":"up"}"]`);(i&&!i.disabled?i:r&&!r.disabled?r:null)?.focus();return}if(this.pendingGeneralFocusRestore){let t=this.pendingGeneralFocusRestore;this.pendingGeneralFocusRestore=null;let n=null;if(t.focusKey)n=Vn(e,"data-gg-focus-key",t.focusKey);if(!n&&t.ariaLabel)n=Vn(e,"aria-label",t.ariaLabel,t.tagName);if(n&&!n.disabled)n.focus()}}createCheckboxRow(e){let t=document.createElement("div");t.className="gg-checkbox-row";let n=document.createElement("label");n.className="gg-checkbox-label";let i=document.createElement("input");if(i.type="checkbox",i.className="gg-checkbox",i.checked=e.checked,i.setAttribute("aria-label",e.ariaLabel),e.focusKey)i.dataset.ggFocusKey=e.focusKey;i.addEventListener("change",()=>{e.onChange(i.checked)});let r=document.createElement("span");return r.textContent=e.label,n.append(i,r),t.append(n),{row:t,checkbox:i}}createCollapsibleCard(e,t,n,i,r=!1,s){let d=document.createElement("section");if(d.className="gg-card",d.dataset.ggSectionId=t,this.expandedSections.has(t))d.classList.add("is-expanded");let u=document.createElement("button");u.type="button",u.className="gg-card-header",u.dataset.ggFocusKey=`card-header:${t}`,u.setAttribute("aria-expanded",String(this.expandedSections.has(t)));let o=document.createElement("span");o.className="gg-card-header-left";let m=document.createElement("span");m.className="gg-card-chevron",m.setAttribute("aria-hidden","true"),m.textContent="▸";let c=document.createElement("span");c.textContent=n,o.append(m,c);let h=document.createElement("span");if(h.className=`gg-card-badge${r?" is-muted":""}`,i!==void 0)h.textContent=i;else h.style.display="none";u.append(o,h);let S=document.createElement("div");S.className="gg-card-body-wrap";let p=`gg-card-body-${t}`;S.id=p,u.setAttribute("aria-controls",p);let l=document.createElement("div");return l.className="gg-section-body",S.append(l),u.addEventListener("click",()=>{let y=!d.classList.contains("is-expanded");if(d.classList.toggle("is-expanded",y),u.setAttribute("aria-expanded",String(y)),y)this.expandedSections.add(t);else this.expandedSections.delete(t);s?.(y)}),d.append(u,S),e.append(d),{body:l,setBadge(y,E=!1){h.textContent=y,h.className=`gg-card-badge${E?" is-muted":""}`,h.style.display=y?"":"none"}}}renderToolbarLayoutSection(e,t){let n=ut(t.toolbarPlacement),i=ct.find((y)=>y.value===n)??ct[0],r=this.createCollapsibleCard(e,"toolbar_layout","Toolbar Position & Order",i.shortLabel,!1),s=r.body,d=document.createElement("p");d.className="gg-muted",d.textContent="Choose where the Guided Generations buttons appear on the composer bar and customize their left-to-right order.",s.append(d);let u=(y,E)=>{let H={...this.currentSettings??t,...y};if(this.currentSettings=H,y.toolbarPlacement!==void 0){let M=ct.find((x)=>x.value===y.toolbarPlacement);if(M)r.setBadge(M.shortLabel,!1)}this.handlers.onSaveSettings(H,E)},o=ie("Bar Placement");s.append(o.wrap),this.handles.push(this.ctx.components.mountSelect(o.slot,{options:Pi,value:n,ariaLabel:"Toolbar Bar Placement",onChange:(y)=>{u({toolbarPlacement:ut(y)},{rebuildDrawer:!1})}}));let m=ie("Button Order (left to right)"),c=document.createElement("div");c.className="gg-order-list";let h=Tt(t.buttonOrder);h.forEach((y,E)=>{let w=document.createElement("div");w.className="gg-order-item",w.setAttribute("data-gg-order-id",y);let H=document.createElement("div");H.className="gg-order-item-left";let M=document.createElement("span");M.className="gg-order-item-icon",M.setAttribute("aria-hidden","true"),M.innerHTML=nt[y];let x=In[y],B=y==="input_recovery"?t.inputRecovery.enabled:y==="guided_scene"?Boolean(t.guidedScene?.enabled):Boolean(t.actions[y]?.enabled),T=document.createElement("span");T.className="gg-order-item-label",T.textContent=x;let I=document.createElement("span");I.className="gg-order-item-state",I.textContent=B?"Visible":"Hidden",this.orderStateTags.set(y,I),H.append(M,T,I);let v=document.createElement("div");v.className="gg-order-item-controls";let A=(O)=>{let C=E+O;if(C<0||C>=h.length)return;this.flushPendingSaves();let N=[...h],[k]=N.splice(E,1);if(!k)return;N.splice(C,0,k);let z=O===-1?C===0?"down":"up":C===N.length-1?"up":"down";this.pendingFocusRestore={optionId:k,button:z},u({buttonOrder:N},{rebuildDrawer:!0})},G=document.createElement("button");G.type="button",G.className="gg-icon-btn-sm",G.dataset.ggMove="up",G.textContent="↑",G.title=`Move ${x} left / up`,G.setAttribute("aria-label",`Move ${x} up`),G.disabled=E===0,G.addEventListener("click",()=>A(-1));let _=document.createElement("button");_.type="button",_.className="gg-icon-btn-sm",_.dataset.ggMove="down",_.textContent="↓",_.title=`Move ${x} right / down`,_.setAttribute("aria-label",`Move ${x} down`),_.disabled=E===h.length-1,_.addEventListener("click",()=>A(1)),v.append(G,_),w.append(H,v),c.append(w)});let S=document.createElement("div");S.className="gg-row";let p=document.createElement("span");p.className="gg-muted",p.textContent="Restore default button order & alignment";let l=document.createElement("button");l.type="button",l.className="gg-btn-sm",l.dataset.ggFocusKey="reset-layout",l.textContent="Reset layout",l.addEventListener("click",()=>{this.flushPendingSaves(),u({toolbarPlacement:"after_native",buttonOrder:[...Ut]},{rebuildDrawer:!0})}),S.append(p,l),m.slot.append(c),s.append(m.wrap,S)}renderActionSection(e,t,n,i,r,s,d){let u=xe[n],o=t.actions[n],m=o.connectionId,c=this.expandedSections.has(n),h=null,S=this.createCollapsibleCard(e,n,u.label,o.enabled?"Visible":"Hidden",!o.enabled,(k)=>{if(k&&!c)c=!0,h?.update({connection:st(m)})}),p=S.body,l=document.createElement("p");l.className="gg-muted",l.textContent=u.description,p.append(l);let y=(k,z={rebuildDrawer:!1})=>{let ee=this.currentSettings??t,j={...ee,actions:{...ee.actions,[n]:{...ee.actions[n],...k}}};if(this.currentSettings=j,k.enabled!==void 0)S.setBadge(k.enabled?"Visible":"Hidden",!k.enabled),this.updateOrderStateTag(n,k.enabled);this.handlers.onSaveSettings(j,z)};p.append(this.createCheckboxRow({label:"Show button on input bar",checked:o.enabled,ariaLabel:`Show ${u.label} button on input bar`,focusKey:`${n}:enabled`,onChange:(k)=>y({enabled:k},{rebuildDrawer:!1})}).row),p.append(this.createCheckboxRow({label:"Clear input bar when triggered",checked:o.clearInputOnRun,ariaLabel:`Clear input bar when running ${u.label}`,focusKey:`${n}:clearInputOnRun`,onChange:(k)=>y({clearInputOnRun:k})}).row),p.append(this.createCheckboxRow({label:"Apply Lumiverse regex scripts",checked:o.applyRegex??Gt,ariaLabel:`Apply Lumiverse regex scripts for ${u.label}`,focusKey:`${n}:applyRegex`,onChange:(k)=>y({applyRegex:k})}).row);let E=Kn(this.ctx),w=ie("API Connection Profile");p.append(w.wrap),this.handles.push(this.ctx.components.mountSelect(w.slot,{options:r,value:o.connectionId??"",ariaLabel:`${u.label} API Connection Profile`,onChange:(k)=>{let z=k||null;m=z,y({connectionId:z}),h?.update(c?{connection:st(z),placeholder:at(z,i,E)}:{placeholder:at(z,i,E)})}}));let H=`gg-${n}-model`,M=ie("Model (blank = connection profile model)",H);if(p.append(M.wrap),typeof this.ctx.components.mountModelCombobox==="function")h=this.ctx.components.mountModelCombobox(M.slot,{value:o.model??"",connection:c?st(m):void 0,appearance:"standard",autoRefreshOnFocus:!0,placeholder:at(m,i,E),onChange:(k)=>{this.scheduleDebouncedSave(`${n}:model`,()=>{y({model:k.trim()||null})})}}),this.attachSlotInputAttributes(M.slot,H,`${u.label} Model`),this.handles.push(h);let x=ie("Preset");p.append(x.wrap),this.handles.push(this.ctx.components.mountSelect(x.slot,{options:s,value:o.presetId??"",ariaLabel:`${u.label} Preset`,onChange:(k)=>y({presetId:k||null})}));let B=ie("Guidance Injection Role");p.append(B.wrap),this.handles.push(this.ctx.components.mountSelect(B.slot,{options:d,value:o.injectionRole,ariaLabel:`${u.label} Guidance Injection Role`,onChange:(k)=>y({injectionRole:k})}));let T=Ft(o.guidancePosition),I=Ct(o.guidanceDepth),v=null,A=`gg-${n}-guidance-depth`,G=ie("In-History Depth (0–999)",A),_=(k)=>{let z=k==="in_history";G.wrap.style.display=z?"":"none",v?.setDisabled(!z)},O=ie("Guidance Position");p.append(O.wrap,G.wrap),this.handles.push(this.ctx.components.mountSelect(O.slot,{options:Li,value:T,ariaLabel:`${u.label} Guidance Position`,onChange:(k)=>{let z=Ft(k);y({guidancePosition:z}),_(z)}})),v=this.mountBoundedIntegerField({slot:G.slot,fieldId:A,ariaLabel:`${u.label} In-history depth`,debounceKey:`${n}:depth`,min:0,max:999,defaultValue:Bt,placeholder:"0",initialValue:I,disabled:T!=="in_history",onCommit:(k)=>{y({guidanceDepth:k})}}),_(T);let C=ie("Guidance Template (supports {{input}} and Lumiverse macros like {{char}}, {{user}}; leave blank for raw input)");p.append(C.wrap);let N=bt(this.ctx,C.slot,{value:o.instructionTemplate,rows:2,placeholder:"{{input}}",ariaLabel:`${u.label} Guidance Template`,expandTitle:`${u.label} — Guidance Template`,onChange:(k)=>{this.scheduleDebouncedSave(`${n}:template`,()=>{y({instructionTemplate:k})})},onModalStateChange:(k)=>{if(!k)this.flushPendingSaves(),queueMicrotask(()=>{this.flushPendingViewIfIdle()})}});this.expandableTextAreas.add(N),this.handles.push(N)}renderGuidedSceneSettingsSection(e,t,n,i,r){let s=mt(t.guidedScene),d="guided_scene",u=s.connectionId,o=this.expandedSections.has("guided_scene"),m=null,c=this.createCollapsibleCard(e,"guided_scene","Guided Scene Settings",s.enabled?"Visible":"Hidden",!s.enabled,(L)=>{if(L&&!o)o=!0,m?.update({connection:st(u)})}),h=c.body,S=document.createElement("p");S.className="gg-muted",S.textContent=Be.description,h.append(S);let p=(L,J={rebuildDrawer:!1})=>{let ke=this.currentSettings??t,fe=mt(ke.guidedScene),le={...ke,guidedScene:{...fe,...L}};if(this.currentSettings=le,L.enabled!==void 0)c.setBadge(L.enabled?"Visible":"Hidden",!L.enabled),this.updateOrderStateTag("guided_scene",L.enabled);this.scenePanel?.setSettings(le),this.handlers.onSaveSettings(le,J)};h.append(this.createCheckboxRow({label:"Show button on input bar",checked:s.enabled,ariaLabel:"Show Guided Scene button on input bar",focusKey:"guided_scene:enabled",onChange:(L)=>p({enabled:L})}).row),h.append(this.createCheckboxRow({label:"Apply Lumiverse regex scripts",checked:s.applyRegex??Gt,ariaLabel:"Apply Lumiverse regex scripts for Guided Scene",focusKey:"guided_scene:applyRegex",onChange:(L)=>p({applyRegex:L})}).row);let l=Kn(this.ctx),y=ie("API Connection Profile");h.append(y.wrap),this.handles.push(this.ctx.components.mountSelect(y.slot,{options:i,value:s.connectionId??"",ariaLabel:"Guided Scene API Connection Profile",onChange:(L)=>{let J=L||null;u=J,p({connectionId:J}),m?.update(o?{connection:st(J),placeholder:at(J,n,l)}:{placeholder:at(J,n,l)})}}));let E="gg-guided_scene-model",w=ie("Model (blank = connection profile model)",E);if(h.append(w.wrap),typeof this.ctx.components.mountModelCombobox==="function")m=this.ctx.components.mountModelCombobox(w.slot,{value:s.model??"",connection:o?st(u):void 0,appearance:"standard",autoRefreshOnFocus:!0,placeholder:at(u,n,l),onChange:(L)=>{this.scheduleDebouncedSave("guided_scene:model",()=>{p({model:L.trim()||null})})}}),this.attachSlotInputAttributes(w.slot,E,"Guided Scene Model"),this.handles.push(m);let H=ie("Preset");h.append(H.wrap),this.handles.push(this.ctx.components.mountSelect(H.slot,{options:r,value:s.presetId??"",ariaLabel:"Guided Scene Preset",onChange:(L)=>p({presetId:L||null})}));let M=Rt(s.contextMode),x=jt(s.contextTurns),B=null,T="gg-guided_scene-context-turns",I=ie("Recent Context Turns (1–200)",T),v=(L)=>{let J=L==="lightweight";I.wrap.style.display=J?"":"none",B?.setDisabled(!J)},A=ie("Rewrite Context Mode");h.append(A.wrap,I.wrap),this.handles.push(this.ctx.components.mountSelect(A.slot,{options:Ni,value:M,ariaLabel:"Guided Scene Rewrite Context Mode",onChange:(L)=>{let J=Rt(L);p({contextMode:J}),v(J)}})),B=this.mountBoundedIntegerField({slot:I.slot,fieldId:T,ariaLabel:"Guided Scene Recent Context Turns",debounceKey:"guided_scene:contextTurns",min:1,max:200,defaultValue:pt,placeholder:String(pt),initialValue:x,disabled:M!=="lightweight",onCommit:(L)=>{p({contextTurns:L})}}),v(M);let G=ie("Steering Injection Role");h.append(G.wrap),this.handles.push(this.ctx.components.mountSelect(G.slot,{options:Fn,value:s.injectionRole,ariaLabel:"Guided Scene Steering Injection Role",onChange:(L)=>p({injectionRole:L})}));let _=At(s.guidancePosition),O=Ct(s.guidanceDepth),C=null,N="gg-guided_scene-guidance-depth",k=ie("In-History Depth (0–999)",N),z=(L)=>{let J=L==="in_history";k.wrap.style.display=J?"":"none",C?.setDisabled(!J)},ee=ie("Steering Guidance Position");h.append(ee.wrap,k.wrap),this.handles.push(this.ctx.components.mountSelect(ee.slot,{options:Di,value:_,ariaLabel:"Guided Scene Steering Guidance Position",onChange:(L)=>{let J=At(L);p({guidancePosition:J}),z(J)}})),C=this.mountBoundedIntegerField({slot:k.slot,fieldId:N,ariaLabel:"Guided Scene In-history depth",debounceKey:"guided_scene:depth",min:0,max:999,defaultValue:Bt,placeholder:"0",initialValue:O,disabled:_!=="in_history",onCommit:(L)=>{p({guidanceDepth:L})}}),z(_);let j="guided_scene:prompts",oe=document.createElement("div");if(oe.className="gg-sub-disclosure",this.expandedSections.has(j))oe.classList.add("is-expanded");let pe="gg-sub-disclosure-body-guided_scene-prompts",ce=document.createElement("button");ce.type="button",ce.className="gg-sub-disclosure-btn",ce.dataset.ggFocusKey="guided_scene:prompts-toggle",ce.setAttribute("aria-expanded",String(this.expandedSections.has(j))),ce.setAttribute("aria-controls",pe);let X=document.createElement("span");X.style.display="inline-flex",X.style.alignItems="center",X.style.gap="5px";let ge=document.createElement("span");ge.setAttribute("aria-hidden","true"),ge.textContent=this.expandedSections.has(j)?"▾":"▸";let _e=document.createElement("span");_e.textContent="Prompt Templates & Readiness Tag",X.append(ge,_e),ce.append(X);let we=document.createElement("div");we.id=pe,we.className="gg-sub-disclosure-body",ce.addEventListener("click",()=>{let L=!oe.classList.contains("is-expanded");if(oe.classList.toggle("is-expanded",L),ce.setAttribute("aria-expanded",String(L)),ge.textContent=L?"▾":"▸",L)this.expandedSections.add(j);else this.expandedSections.delete(j)});let F="gg-guided_scene-readiness-tag",Fe=ie("Readiness Tag (emitted as <tag/> in Multi-Turn steering)",F),he=document.createElement("input");he.type="text",he.id=F,he.className="gg-input-sm",he.value=s.readinessTag,he.placeholder=Ze,he.setAttribute("aria-label","Guided Scene Readiness Tag"),he.addEventListener("input",()=>{this.scheduleDebouncedSave("guided_scene:readinessTag",()=>{p({readinessTag:Mt(he.value)})})}),he.addEventListener("blur",()=>{let L=Mt(he.value);he.value=L}),Fe.slot.append(he),we.append(Fe.wrap);let Ee=[{key:"steeringTemplate",label:"Steering Directive Template ({{scene}}, {{delivery}}, {{transitionNote}}, {{readinessTag}})",expandTitle:"Steering Directive Template",ariaLabel:"Guided Scene Steering Directive Template",value:s.steeringTemplate},{key:"adaptTemplate",label:"Context Adapt Template ({{scene}}, {{delivery}}, {{transitionNote}}, {{customDirection}})",expandTitle:"Context Adapt Template",ariaLabel:"Guided Scene Context Adapt Template",value:s.adaptTemplate},{key:"summaryTemplate",label:"Summary Rewrite Template ({{scene}}, {{delivery}}, {{transitionNote}}, {{customDirection}})",expandTitle:"Summary Rewrite Template",ariaLabel:"Guided Scene Summary Rewrite Template",value:s.summaryTemplate},{key:"bridgeTemplate",label:"In-Scene Bridge Template ({{scene}}, {{delivery}}, {{transitionNote}}, {{customDirection}})",expandTitle:"In-Scene Bridge Template",ariaLabel:"Guided Scene In-Scene Bridge Template",value:s.bridgeTemplate}];for(let L of Ee){let J=ie(L.label);we.append(J.wrap);let ke=bt(this.ctx,J.slot,{value:L.value,rows:3,ariaLabel:L.ariaLabel,expandTitle:L.expandTitle,onChange:(fe)=>{this.scheduleDebouncedSave(`guided_scene:${L.key}`,()=>{p({[L.key]:fe})})},onModalStateChange:(fe)=>{if(!fe)this.flushPendingSaves(),queueMicrotask(()=>{this.flushPendingViewIfIdle()})}});this.expandableTextAreas.add(ke),this.handles.push(ke)}let me=document.createElement("div");me.className="gg-row";let lt=document.createElement("span");lt.className="gg-muted",lt.textContent="Restore default Guided Scene prompts & tag";let re=document.createElement("button");re.type="button",re.className="gg-btn-sm",re.dataset.ggFocusKey="reset-scene-prompts",re.textContent="Reset Prompts",re.addEventListener("click",()=>{this.flushPendingSaves(),p({readinessTag:Ze,steeringTemplate:Vt,adaptTemplate:Kt,summaryTemplate:zt,bridgeTemplate:$t},{rebuildDrawer:!0})}),me.append(lt,re),we.append(me),oe.append(ce,we),h.append(oe)}mountBoundedIntegerField(e){let t=(o)=>{if(typeof o==="number"&&Number.isFinite(o))return Math.max(e.min,Math.min(e.max,Math.floor(o)));return Math.max(e.min,Math.min(e.max,Math.floor(e.defaultValue)))},n=t(e.initialValue),i=!1,r=!1,s=null,d=null,u=(o)=>{if(r)return;if(o===null){i=!0,this.cancelPendingSaveKey(e.debounceKey);return}i=!1;let m=t(o);n=m,this.scheduleDebouncedSave(e.debounceKey,()=>{e.onCommit(m)})};if(typeof this.ctx.components.mountNumericInput==="function")s=this.ctx.components.mountNumericInput(e.slot,{value:n,min:e.min,max:e.max,step:1,integer:!0,allowEmpty:!0,placeholder:e.placeholder,disabled:Boolean(e.disabled),ariaLabel:e.ariaLabel,onChange:u}),this.attachSlotInputAttributes(e.slot,e.fieldId,e.ariaLabel),e.slot.addEventListener("focusout",(o)=>{let m=o.relatedTarget;if(m&&e.slot.contains(m))return;if(i||s?.getValue()===null){i=!1;let c=t(e.defaultValue);if(c!==n)n=c,e.onCommit(c)}else this.flushPendingSaveKey(e.debounceKey);if(s&&s.getValue()!==n){r=!0;try{s.update({value:n})}finally{r=!1}}}),this.handles.push(s);else{let o=document.createElement("input");o.type="number",o.id=e.fieldId,o.className="gg-input-sm",o.min=String(e.min),o.max=String(e.max),o.step="1",o.placeholder=e.placeholder,o.value=String(n),o.disabled=Boolean(e.disabled),o.setAttribute("aria-label",e.ariaLabel),o.addEventListener("input",()=>{let m=o.value.trim(),c=m===""?null:Number(m);u(c!==null&&Number.isFinite(c)?c:null)}),o.addEventListener("blur",()=>{if(i||o.value.trim()===""){i=!1;let m=t(e.defaultValue);if(m!==n)n=m,e.onCommit(m)}else this.flushPendingSaveKey(e.debounceKey);o.value=String(n)}),d=o,e.slot.append(o)}return{setDisabled:(o)=>{if(s){r=!0;try{s.update({disabled:o})}finally{r=!1}}if(d)d.disabled=o}}}updateOrderStateTag(e,t){let n=this.orderStateTags.get(e);if(n)n.textContent=t?"Visible":"Hidden"}renderRecoverySection(e,t,n){let i=this.createCollapsibleCard(e,"input_recovery","Input Recovery",n.length>0?String(n.length):void 0,n.length===0),r=i.body,s=document.createElement("p");s.className="gg-muted",s.textContent="Automatically saves composer input cleared or replaced by guided actions so you can restore it in one click. When no saved inputs exist, clicking Input Recovery clears the current input.",r.append(s),r.append(this.createCheckboxRow({label:"Enable Input Recovery & toolbar button",checked:t.inputRecovery.enabled,ariaLabel:"Show Input Recovery button on input bar",focusKey:"input_recovery:enabled",onChange:(h)=>{let S=this.currentSettings??t,p={...S,inputRecovery:{...S.inputRecovery,enabled:h}};this.currentSettings=p,this.updateOrderStateTag("input_recovery",h),this.handlers.onSaveSettings(p,{rebuildDrawer:!1})}}).row);let d="gg-recovery-max-entries",u=ie("Max saved drafts (1–50)",d);r.append(u.wrap),this.mountBoundedIntegerField({slot:u.slot,fieldId:d,ariaLabel:"Max saved drafts",debounceKey:"recovery:maxEntries",min:1,max:50,defaultValue:10,placeholder:"10",initialValue:t.inputRecovery.maxEntries,onCommit:(h)=>{let S=this.currentSettings??t,p={...S,inputRecovery:{...S.inputRecovery,maxEntries:h}};if(this.currentSettings=p,this.recoveryUi)this.recoveryUi.maxEntries=h,this.recoveryUi.countLabel.textContent=this.recoveryUi.recoveryCount>0?`Saved inputs (${this.recoveryUi.recoveryCount}/${h}):`:"No saved inputs yet.";this.handlers.onSaveSettings(p,{rebuildDrawer:!1})}});let o=document.createElement("div");o.className="gg-row";let m=document.createElement("span");m.className="gg-muted",m.textContent=n.length>0?`Saved inputs (${n.length}/${t.inputRecovery.maxEntries}):`:"No saved inputs yet.";let c=document.createElement("button");c.type="button",c.className="gg-btn-sm",c.dataset.ggFocusKey="clear-recovery",c.textContent="Clear History",c.disabled=this.recoveryBusy||n.length===0,c.addEventListener("click",()=>{this.handlers.onClearRecovery()}),o.append(m,c),r.append(o),this.recoveryUi={setBadge:i.setBadge,countLabel:m,clearBtn:c,body:r,listEl:null,entries:[],maxEntries:t.inputRecovery.maxEntries,recoveryCount:n.length},this.syncRecoveryList(n)}syncRecoveryList(e){let t=this.recoveryUi;if(!t)return;if(e.length===0){if(t.entries=[],t.listEl)t.listEl.remove(),t.listEl=null;return}if(t.listEl&&t.entries.length===e.length&&t.entries.every((r,s)=>{let d=e[s];return r.id===d.id&&r.text===d.text&&r.actionId===d.actionId}))return;t.entries=[...e];let n=t.listEl;if(!n)n=document.createElement("div"),n.className="gg-recovery-list",n.addEventListener("click",(r)=>{let d=r.target?.closest("button[data-gg-recovery-index]");if(!d||d.disabled)return;let u=Number(d.dataset.ggRecoveryIndex),o=Number.isInteger(u)?this.recoveryUi?.entries[u]:void 0;if(o)this.handlers.onRestoreEntry(o)}),t.listEl=n,t.body.append(n);let i=document.createDocumentFragment();e.forEach((r,s)=>{let d=document.createElement("div");d.className="gg-recovery-item";let u=document.createElement("div");u.className="gg-recovery-meta";let o=xe[r.actionId]?.label??r.actionId,m=document.createElement("span");m.className="gg-recovery-tag",m.textContent=o;let c=document.createElement("span");c.className="gg-recovery-snippet",c.textContent=rt(r.text),c.title=r.text,u.append(m,c);let h=document.createElement("button");h.type="button",h.className="gg-btn-sm",h.dataset.ggRecoveryIndex=String(s),h.textContent="Restore",h.disabled=this.recoveryBusy,h.setAttribute("aria-label",`Restore ${o} draft: ${rt(r.text,40)}`),d.append(u,h),i.append(d)}),n.replaceChildren(i)}attachSlotInputAttributes(e,t,n){let i=()=>{let s=e.querySelector("input");if(!s)return!1;if(!s.id)s.id=t;if(!s.getAttribute("aria-label"))s.setAttribute("aria-label",n);return!0};if(i()||typeof MutationObserver!=="function")return;let r=new MutationObserver(()=>{if(i())r.disconnect()});r.observe(e,{childList:!0,subtree:!0}),this.handles.push({destroy:()=>r.disconnect()})}scheduleDebouncedSave(e,t,n=250){let i=this.debounceTimers.get(e);if(i)clearTimeout(i.timer);let r=()=>{if(this.destroyed)return;t()},s=setTimeout(()=>{this.debounceTimers.delete(e),r(),this.flushPendingViewIfIdle()},n);this.debounceTimers.set(e,{timer:s,flush:r})}flushPendingSaves(){if(this.destroyed||this.debounceTimers.size===0)return;let e=Array.from(this.debounceTimers.entries());this.debounceTimers.clear();for(let[,t]of e)clearTimeout(t.timer),t.flush()}flushPendingSaveKey(e){if(this.destroyed)return;let t=this.debounceTimers.get(e);if(!t)return;this.debounceTimers.delete(e),clearTimeout(t.timer),t.flush()}cancelPendingSaveKey(e){let t=this.debounceTimers.get(e);if(!t)return;this.debounceTimers.delete(e),clearTimeout(t.timer)}cancelPendingSaves(){for(let e of this.debounceTimers.values())clearTimeout(e.timer);this.debounceTimers.clear()}clearComponentHandles(){this.expandableTextAreas.clear();for(let e of this.handles)e.destroy();this.handles=[]}destroy(){if(this.flushPendingSaves(),this.destroyed=!0,this.pendingView=null,this.pendingFocusRestore=null,this.pendingGeneralFocusRestore=null,this.pointerActiveInDrawer=!1,this.pointerFallbackTimer!==null)clearTimeout(this.pointerFallbackTimer),this.pointerFallbackTimer=null;if(this.pendingViewFlushTimer!==null)clearTimeout(this.pendingViewFlushTimer),this.pendingViewFlushTimer=null;if(this.pointerReleaseCleanup){let e=this.pointerReleaseCleanup;this.pointerReleaseCleanup=null,e()}for(let e of[...this.tabConnectionCleanups])e();this.tabConnectionCleanups.clear(),this.scenePanel?.destroy(),this.scenePanel=null,this.shellEl=null,this.navEl=null,this.navButtons.clear(),this.navArmedDotEl=null,this.subNavButtons.clear(),this.subNavArmedDotEl=null,this.stickyNoticeSlotEl=null,this.bodyScrollEl=null,this.basicViewEl=null,this.advancedViewEl=null,this.basicHostEl=null,this.sceneWorkbenchHostEl=null,this.sceneSettingsHostEl=null,this.rootEl=null,this.noticeEl=null,this.recoveryUi=null,this.orderStateTags.clear(),this.tab.root.removeEventListener("pointerdown",this.onPointerDownInDrawer),this.tab.root.removeEventListener("mousedown",this.onPointerDownInDrawer),this.tab.root.removeEventListener("focusout",this.onFocusOut),this.cancelPendingSaves(),this.clearComponentHandles(),this.tab.root.replaceChildren(),this.tab.destroy()}}function Pt(e){return Boolean(e&&typeof e==="object"&&e.nodeType===1)}var Hi=new Set(["checkbox","radio","button","submit","reset"]);function Un(e){let t=e.tagName;if(t==="INPUT"){let i=e.type?.toLowerCase()??"text";return!Hi.has(i)}if(t==="TEXTAREA"||t==="SELECT"||e.isContentEditable)return!0;if(e.classList.contains("gg-card-header")||e.classList.contains("gg-sub-disclosure-btn")||e.classList.contains("gg-drawer-nav-btn")||e.classList.contains("gg-subnav-btn")||e.classList.contains("gg-segmented-btn"))return!1;let n=e.getAttribute("role");if(n==="combobox"||n==="listbox"||n==="option")return!0;if(e.getAttribute("aria-expanded")==="true")return!0;return Boolean(e.closest?.('[role="combobox"], [role="listbox"], [role="option"], [aria-expanded="true"]:not(.gg-card-header):not(.gg-sub-disclosure-btn)'))}function Bi(e,t){if(!Pt(t)||!e.contains(t))return!1;return Boolean(t.closest('button, input[type="checkbox"], label, [role="button"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"], summary, a[href]'))}function Gi(e){if(typeof CSS<"u"&&typeof CSS.escape==="function")return CSS.escape(e);return e.replace(/\\/g,"\\\\").replace(/"/g,"\\\"")}function Vn(e,t,n,i){let r=i?i.toLowerCase():"";try{let s=Gi(n);return e.querySelector(`${r}[${t}="${s}"]`)}catch{for(let s of e.querySelectorAll(`${r}[${t}]`))if(s.getAttribute(t)===n)return s;return null}}function Kn(e){return e.connections?.getActive?.()?.activeProfileId??null}function st(e){return e?{kind:"llm",id:e}:{kind:"llm"}}function at(e,t,n){let r=(e?t.find((s)=>s.id===e):(n?t.find((s)=>s.id===n):void 0)??t.find((s)=>s.isDefault)??t[0])?.model?.trim();return r?`Use connection model (${r})`:"Leave blank for connection model"}var Oi=0;function ie(e,t){let n=document.createElement("div");n.className="gg-field";let i=document.createElement("label");if(i.className="gg-field-label",i.id=`gg-field-label-${++Oi}`,t)i.htmlFor=t;i.textContent=e;let r=document.createElement("div");return n.append(i,r),{wrap:n,slot:r,label:i}}function Fi(e){return[{value:"",label:"Use Active Connection",sublabel:"Inherits whichever connection profile is currently active"},...e.map((t)=>({value:t.id,label:t.name,sublabel:t.model?`${t.provider} · ${t.model}`:t.provider}))]}function Ui(e){return[{value:"",label:"Use Active Preset",sublabel:"Inherits the active chat or connection preset"},...e.map((t)=>({value:t.id,label:t.name}))]}var Vi=new Set(["guided_response","guided_regenerate","guided_swipe","guided_continue","guided_scene"]),zn=new Set(["guided_response","guided_regenerate","guided_scene"]),Ki=new Set(["guided_continue","guided_swipe"]);function $n(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}class rn{ctx;disposers=[];runStateById=new Map;currentRun=null;viewedSwipeId=void 0;swipeInitialized=!1;contentSeen=!1;mountedEl=null;mountedTarget=null;mountedPosition=null;mountedIsMessageContent=null;mountedMessageId=null;streamAfterMount=null;optimisticStreamEl=null;rafId=null;rafTimerId=null;rowObserver=null;observedRow=null;rafRetries=0;retryMode=null;destroyed=!1;constructor(e){this.ctx=e;if(typeof this.ctx.events?.on==="function"){let t=()=>{if(!this.destroyed)this.rafRetries=0,this.syncCurrent()};this.disposers.push(this.ctx.events.on("MESSAGE_SWIPED",(n)=>{this.onMessageEvent(n,"MESSAGE_SWIPED")}),this.ctx.events.on("MESSAGE_EDITED",(n)=>{this.onMessageEvent(n,"MESSAGE_EDITED")}),this.ctx.events.on("MESSAGE_SENT",(n)=>{this.onMessageEvent(n,"MESSAGE_SENT")}),this.ctx.events.on("CHAT_CHANGED",t),this.ctx.events.on("CHAT_SWITCHED",t))}}sync(e){if(this.destroyed)return;let t=this.currentRun;if(t)this.saveRunState(t.runId);if(t?.runId!==e?.runId){let n=e?this.runStateById.get(e.runId):void 0;if(n)this.contentSeen=n.contentSeen,this.viewedSwipeId=n.viewedSwipeId,this.swipeInitialized=n.swipeInitialized;else this.contentSeen=!1,this.viewedSwipeId=void 0,this.swipeInitialized=!1;this.resetRetry()}else if(t?.messageId!==e?.messageId)this.resetRetry();if(this.currentRun=e,e&&!this.swipeInitialized&&e.swipeId!==void 0)this.viewedSwipeId=e.backgroundSwipe?void 0:e.swipeId,this.swipeInitialized=!0;if(e)this.saveRunState(e.runId);this.syncCurrent()}destroy(){if(this.destroyed)return;this.destroyed=!0,this.resetRetry(),this.unmount(),this.streamAfterMount=null,this.currentRun=null,this.runStateById.clear();for(let e of this.disposers)try{e()}catch{}this.disposers.length=0}saveRunState(e){if(!e)return;if(this.runStateById.has(e))this.runStateById.delete(e);if(this.runStateById.set(e,{viewedSwipeId:this.viewedSwipeId,swipeInitialized:this.swipeInitialized,contentSeen:this.contentSeen}),this.runStateById.size>32){let t=this.runStateById.keys().next().value;if(t!==void 0)this.runStateById.delete(t)}}onMessageEvent(e,t){if(this.destroyed||!this.currentRun?.messageId)return;let n=$n(e)?e:null,i=n&&$n(n.message)?n.message:null,r=typeof i?.id==="string"?i.id:typeof n?.messageId==="string"?n.messageId:void 0;if(r!==void 0&&r!==this.currentRun.messageId)return;if(r===this.currentRun.messageId){let s=this.viewedSwipeId,d=this.swipeInitialized,u=this.contentSeen,o=typeof i?.swipe_id==="number"?i.swipe_id:typeof n?.swipeId==="number"?n.swipeId:void 0;if(o!==void 0)this.viewedSwipeId=o,this.swipeInitialized=!0;if(typeof i?.content==="string"&&i.content.length>0&&(this.currentRun.swipeId==null||this.viewedSwipeId===this.currentRun.swipeId||this.viewedSwipeId===void 0))this.contentSeen=!0;if(this.viewedSwipeId!==s||this.swipeInitialized!==d||this.contentSeen!==u)this.saveRunState(this.currentRun.runId);if(t==="MESSAGE_SWIPED")this.rafRetries=0}this.syncCurrent()}syncCurrent(){if(this.destroyed)return;let e=this.currentRun,t=this.resolveDisplayPlan(e);if(t.kind==="none"){this.resetRetry(),this.unmount();return}if(t.kind==="stream_after"){this.resetRetry(),this.unmountRow(),this.mountOptimisticStreamAfter();return}if(typeof this.ctx.dom?.findMessageElement!=="function"||typeof this.ctx.dom?.inject!=="function"){if(t.allowStreamAfterFallback)this.mountOptimisticStreamAfter();return}if(this.mountedEl&&this.mountedTarget&&this.mountedPosition&&this.mountedIsMessageContent===!0&&this.mountedMessageId===t.messageId&&this.mountedEl.isConnected&&this.mountedTarget.isConnected&&this.isMountedAt(this.mountedEl,this.mountedTarget,this.mountedPosition)){this.unmountOptimisticStreamAfter(),this.resetRetry();return}let n=this.resolveTarget(t.messageId,t.actionId);if(!n){if(this.unmountRow(),t.allowStreamAfterFallback)this.mountOptimisticStreamAfter();else this.unmountOptimisticStreamAfter();if(t.retryRowIfMissing)this.ensureRetryMode("row"),this.scheduleRetry();else this.resetRetry();return}let i=Boolean(e?.hasContentOutput||this.contentSeen);if(this.unmountOptimisticStreamAfter(),this.mountedEl&&this.mountedTarget===n.element&&this.mountedPosition===n.position&&this.mountedIsMessageContent===n.isMessageContent&&this.mountedMessageId===t.messageId&&this.isMountedAt(this.mountedEl,n.element,n.position)){if(!n.isMessageContent&&i)this.ensureRetryMode("content"),this.scheduleRetry(n.row);else this.resetRetry();return}this.unmountRow();let r=n.isMessageContent?'<div class="gg-streaming-indicator gg-streaming-indicator--after" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>':'<div class="gg-streaming-indicator" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';if(this.mountedEl=this.ctx.dom.inject(n.element,r,n.position),this.mountedTarget=n.element,this.mountedPosition=n.position,this.mountedIsMessageContent=n.isMessageContent,this.mountedMessageId=t.messageId,!n.isMessageContent&&i)this.ensureRetryMode("content"),this.scheduleRetry(n.row);else this.resetRetry()}resolveDisplayPlan(e){if(!e||this.destroyed)return{kind:"none"};if(!Vi.has(e.actionId))return{kind:"none"};let t=this.safeGetActiveChatId();if(!t||e.chatId!==t)return{kind:"none"};if(typeof e.messageId==="string"&&e.messageId.length>0){if(e.actionId==="guided_swipe"){if(typeof e.swipeId!=="number"||this.viewedSwipeId!==e.swipeId)return{kind:"none"}}else if(e.swipeId!=null&&this.viewedSwipeId!==e.swipeId)return{kind:"none"};return{kind:"row",messageId:e.messageId,actionId:e.actionId,allowStreamAfterFallback:zn.has(e.actionId),retryRowIfMissing:!0}}if(e.actionId==="guided_swipe"&&e.backgroundSwipe)return{kind:"none"};if(zn.has(e.actionId))return{kind:"stream_after"};if(Ki.has(e.actionId)){if(typeof this.ctx.messages?.getLatestMessageId==="function"){let i=this.safeGetLatestMessageId();if(!i)return{kind:"none"};return{kind:"row",messageId:i,actionId:e.actionId,allowStreamAfterFallback:!0,retryRowIfMissing:!1}}return{kind:"stream_after"}}return{kind:"none"}}safeGetLatestMessageId(){try{let e=this.ctx.messages?.getLatestMessageId?.();return typeof e==="string"&&e.length>0?e:null}catch{return null}}getStreamAfterMount(){if(this.destroyed)return null;if(this.streamAfterMount)return this.streamAfterMount;if(typeof this.ctx.ui?.mount!=="function")return null;try{return this.streamAfterMount=this.ctx.ui.mount("chat_stream_after"),this.streamAfterMount}catch{return null}}mountOptimisticStreamAfter(){if(this.destroyed)return;let e=this.getStreamAfterMount();if(!e)return;if(this.optimisticStreamEl&&this.optimisticStreamEl.parentNode===e)return;if(this.unmountOptimisticStreamAfter(),typeof document>"u")return;let t=document.createElement("div");t.innerHTML='<div class="gg-streaming-indicator gg-streaming-indicator--optimistic" data-gg-optimistic-indicator="true" role="status" aria-label="Generating response"><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span><span class="gg-streaming-dot"></span></div>';let n=t.firstElementChild;if(!n)return;e.append(n),this.optimisticStreamEl=n}unmountOptimisticStreamAfter(){let e=this.optimisticStreamEl;if(this.optimisticStreamEl=null,!e)return;try{e.remove()}catch{}}safeGetActiveChatId(){try{return this.ctx.getActiveChat?.().chatId??null}catch{return null}}isMountedAt(e,t,n){if(n==="afterend")return t.parentNode!==null&&t.nextElementSibling===e;if(n==="beforebegin")return t.parentNode!==null&&t.previousElementSibling===e;return t.contains(e)}resolveTarget(e,t){if(typeof this.ctx.dom?.findMessageElement!=="function")return null;let n=this.ctx.dom.findMessageElement(e);if(!n)return null;let i=n.querySelector('[data-component="MessageContent"]');if(i)return{row:n,element:i,position:"afterend",isMessageContent:!0};if(t==="guided_continue")return this.resolveContinueFallbackTarget(n);let r=n.querySelector('[data-spindle-mount="message_body_before"]');if(r)return{row:n,element:r,position:"beforeend",isMessageContent:!1};let s=n.querySelector('[data-spindle-mount="message_body_after"]');if(s)return{row:n,element:s,position:"beforeend",isMessageContent:!1};let d=n.querySelector('[data-component="BubbleMessage"] > div > div:last-child');if(d)return{row:n,element:d,position:"beforeend",isMessageContent:!1};if(typeof n.matches==="function"&&n.matches('[data-component="BubbleMessage"]')){let o=n.firstElementChild?.lastElementChild;return o?{row:n,element:o,position:"beforeend",isMessageContent:!1}:null}let u=n.querySelector('[data-component="MinimalMessage"] > div');if(u)return{row:n,element:u,position:"beforeend",isMessageContent:!1};if(typeof n.matches==="function"&&n.matches('[data-component="MinimalMessage"]')){let o=n.firstElementChild;return o?{row:n,element:o,position:"beforeend",isMessageContent:!1}:null}return null}resolveContinueFallbackTarget(e){let t=e.querySelector('[data-spindle-mount="message_body_after"]');if(t)return{row:e,element:t,position:"beforeend",isMessageContent:!1};let n=e.querySelector('[data-spindle-mount="message_body_before"]');if(n)return{row:e,element:n,position:"beforeend",isMessageContent:!1};let i=e.querySelector('[data-component="BubbleMessage"] [class*="content"]');if(i)return{row:e,element:i,position:"beforeend",isMessageContent:!1};if(typeof e.matches==="function"&&e.matches('[data-component="BubbleMessage"]')){let d=e.querySelector('[class*="content"]')??e.firstElementChild?.lastElementChild;if(d)return{row:e,element:d,position:"beforeend",isMessageContent:!1}}let r=e.querySelector('[data-component="BubbleMessage"] > div > div:last-child');if(r)return{row:e,element:r,position:"beforeend",isMessageContent:!1};let s=e.querySelector('[data-component="MinimalMessage"] > div');if(s)return{row:e,element:s,position:"beforeend",isMessageContent:!1};if(typeof e.matches==="function"&&e.matches('[data-component="MinimalMessage"]')&&e.firstElementChild)return{row:e,element:e.firstElementChild,position:"beforeend",isMessageContent:!1};return{row:e,element:e,position:"beforeend",isMessageContent:!1}}ensureRetryMode(e){if(this.retryMode!==e)this.cancelRetry(),this.rafRetries=0,this.retryMode=e}resetRetry(){this.cancelRetry(),this.rafRetries=0,this.retryMode=null}unmountRow(){let e=this.mountedEl;if(this.mountedEl=null,this.mountedTarget=null,this.mountedPosition=null,this.mountedIsMessageContent=null,this.mountedMessageId=null,this.disconnectRowObserver(),!e)return;try{if(typeof this.ctx.dom?.uninject==="function")this.ctx.dom.uninject(e);else e.remove()}catch{}}unmount(){this.unmountRow(),this.unmountOptimisticStreamAfter()}scheduleRetry(e){if(this.destroyed||this.rafId!==null||this.rafTimerId!==null)return;if(this.rowObserver!==null){if(e&&this.observedRow===e)return;this.disconnectRowObserver()}if(this.rafRetries<2){this.rafRetries+=1;let i=typeof globalThis.requestAnimationFrame==="function"?globalThis.requestAnimationFrame.bind(globalThis):void 0;if(i)this.rafId=i(()=>{if(this.rafId=null,!this.destroyed)this.syncCurrent()});else this.rafTimerId=setTimeout(()=>{if(this.rafTimerId=null,!this.destroyed)this.syncCurrent()},16);return}if(this.retryMode==="content"&&e&&typeof globalThis.MutationObserver==="function"){let i=new globalThis.MutationObserver((r)=>{if(this.destroyed||this.retryMode!=="content"){this.disconnectRowObserver();return}let s=!1;for(let d of r){for(let u=0;u<d.addedNodes.length;u+=1)if(d.addedNodes[u]?.nodeType===1){s=!0;break}if(s)break}if(s)this.syncCurrent()});i.observe(e,{childList:!0,subtree:!0}),this.rowObserver=i,this.observedRow=e;return}if(this.rafRetries>=10)return;let t=this.rafRetries-2;this.rafRetries+=1;let n=Math.min(500,32*2**t);this.rafTimerId=setTimeout(()=>{if(this.rafTimerId=null,!this.destroyed)this.syncCurrent()},n)}disconnectRowObserver(){if(this.rowObserver){try{this.rowObserver.disconnect()}catch{}this.rowObserver=null}this.observedRow=null}cancelRetry(){if(this.rafId!==null){if(typeof globalThis.cancelAnimationFrame==="function")globalThis.cancelAnimationFrame(this.rafId);this.rafId=null}if(this.rafTimerId!==null)clearTimeout(this.rafTimerId),this.rafTimerId=null;this.disconnectRowObserver()}}var jn=`
/* Input Toolbar Host & Buttons */
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
    box-shadow var(--lcs-transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
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
  background: var(--lumiverse-primary-020, rgba(139, 92, 246, 0.22));
  color: var(--lumiverse-primary, #c4b5fd);
  box-shadow: 0 0 0 2px var(--lumiverse-primary-050, rgba(139, 92, 246, 0.35));
  transform: scale(0.92);
}

.gg-btn.is-running {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.2));
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
  box-shadow: 0 0 0 1px var(--lumiverse-danger-050, rgba(248, 113, 113, 0.35));
}

.gg-btn.is-armed {
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  color: var(--lumiverse-primary, #a78bfa);
  box-shadow: 0 0 0 1px var(--lumiverse-primary-050, rgba(147, 112, 219, 0.42));
}

.gg-btn.is-armed::after {
  content: "";
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--lumiverse-primary, #a78bfa);
  box-shadow: 0 0 5px var(--lumiverse-primary-050, rgba(147, 112, 219, 0.65));
  pointer-events: none;
}

.gg-btn.is-armed.is-paused {
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.14));
  color: var(--lumiverse-warning-text, var(--lumiverse-warning, #f59e0b));
  box-shadow: 0 0 0 1px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.4));
}

.gg-btn.is-armed.is-paused::after {
  background: var(--lumiverse-warning, #f59e0b);
  box-shadow: 0 0 5px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.55));
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

/* Unified Minimalist Borderless Drawer (Media Localizer Aesthetic) */
[data-spindle-drawer-tab]:has(> .gg-drawer-root) {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.gg-drawer-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--lumiverse-text, var(--text-primary, rgba(255, 255, 255, 0.92)));
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 12px;
  line-height: 1.4;
  overflow: visible;
}

.gg-drawer-root :focus-visible {
  outline: 1.5px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  outline-offset: 1px;
}

.gg-drawer-root input[type="checkbox"] {
  accent-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
}

/* Thin Custom Scrollbars (5px Media Localizer style) */
.gg-drawer-body,
.gg-recovery-list,
.gg-scene-preview-ta {
  scrollbar-width: thin;
  scrollbar-color: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22)) transparent;
}

.gg-drawer-body::-webkit-scrollbar,
.gg-recovery-list::-webkit-scrollbar,
.gg-scene-preview-ta::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

.gg-drawer-body::-webkit-scrollbar-track,
.gg-recovery-list::-webkit-scrollbar-track,
.gg-scene-preview-ta::-webkit-scrollbar-track {
  background: transparent;
}

.gg-drawer-body::-webkit-scrollbar-thumb,
.gg-recovery-list::-webkit-scrollbar-thumb,
.gg-scene-preview-ta::-webkit-scrollbar-thumb {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22));
  border-radius: 999px;
}

.gg-drawer-body::-webkit-scrollbar-thumb:hover,
.gg-recovery-list::-webkit-scrollbar-thumb:hover,
.gg-scene-preview-ta::-webkit-scrollbar-thumb:hover {
  background: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.5));
}

/* Sticky Top-Level Segmented Nav Bar (Basic | Advanced) */
.gg-drawer-nav {
  display: flex;
  flex-wrap: nowrap;
  gap: 3px;
  min-width: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  background: var(--lumiverse-bg-darker, rgba(0, 0, 0, 0.14));
  flex-shrink: 0;
}

.gg-drawer-nav-btn {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: nowrap;
  padding: 4.5px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(255, 255, 255, 0.65)));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.gg-drawer-nav-btn:hover {
  color: var(--lumiverse-text, var(--text-primary, rgba(255, 255, 255, 0.92)));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
}

.gg-drawer-nav-btn.is-active {
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-weight: 600;
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.42));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 1px 3px rgba(0, 0, 0, 0.14);
}

.gg-drawer-nav-btn .gg-nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gg-drawer-nav-btn .gg-nav-icon svg {
  width: 13px;
  height: 13px;
  display: block;
}

.gg-drawer-nav-btn.is-active .gg-nav-icon {
  color: var(--lumiverse-primary, #a78bfa);
}

.gg-nav-armed-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--lumiverse-primary, #a78bfa);
  box-shadow: 0 0 5px var(--lumiverse-primary-050, rgba(147, 112, 219, 0.55));
  flex-shrink: 0;
}

.gg-nav-armed-dot.is-paused {
  background: var(--lumiverse-warning, #f59e0b);
  box-shadow: 0 0 5px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.5));
}

/* Inner Advanced Sub-Tab Strip (Extensible for future advanced features) */
.gg-subnav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.gg-subnav-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3.5px 9px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(255, 255, 255, 0.72)));
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.gg-subnav-btn:hover {
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.3));
  color: var(--lumiverse-text, currentColor);
}

.gg-subnav-btn.is-active {
  background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.2));
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.5));
  color: var(--lumiverse-text, currentColor);
  font-weight: 600;
}

.gg-subnav-btn svg {
  width: 12px;
  height: 12px;
  display: block;
  flex-shrink: 0;
}

.gg-subnav-btn.is-active svg {
  color: var(--lumiverse-primary, #a78bfa);
}

/* Sticky Notice Slot & Scrollable Drawer Body */
.gg-drawer-sticky-slot {
  padding: 6px 10px 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gg-drawer-sticky-slot:empty {
  display: none;
}

.gg-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gg-drawer-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.gg-drawer-view.is-hidden {
  display: none;
}

/* Basic View (Borderless Flat Sections) */
.gg-drawer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-size: 12px;
  min-width: 0;
}

.gg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
}

.gg-header h2 {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--lumiverse-text, var(--text-primary, currentColor));
}

.gg-muted {
  margin: 2px 0 0;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.65)));
  font-size: 11px;
  line-height: 1.4;
}

.gg-notice {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-primary-050, rgba(59, 130, 246, 0.35));
  background: var(--lumiverse-primary-015, rgba(59, 130, 246, 0.12));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-size: 11.5px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.gg-notice.is-error {
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.45));
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.13));
  color: var(--lumiverse-danger-text, var(--lumiverse-text, var(--text-primary, currentColor)));
}

.gg-notice.is-warn {
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.42));
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.12));
  color: var(--lumiverse-warning-text, var(--lumiverse-text, var(--text-primary, currentColor)));
}

/* Flat Borderless Flow Sections (Shared by Basic & Advanced) */
.gg-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.gg-section + .gg-section {
  padding-top: 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.gg-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(255, 255, 255, 0.62)));
}

.gg-section-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px 8px;
}

/* Flat Borderless Collapsible Rows (Remodeled Settings Sections) */
.gg-card {
  border: none;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
  padding-top: 2px;
}

.gg-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  transition: background var(--lumiverse-transition-fast, 150ms ease);
}

.gg-card-header:hover {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
}

.gg-card-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.gg-card-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 11px;
  transition: transform 140ms ease;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
  opacity: 0.78;
}

.gg-card.is-expanded .gg-card-chevron {
  transform: rotate(90deg);
}

.gg-card-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.32));
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.15));
  color: var(--lumiverse-primary-text, var(--lumiverse-primary, #c4b5fd));
  font-variant-numeric: tabular-nums;
}

.gg-card-badge.is-muted {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.1));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.65)));
}

.gg-card-body-wrap {
  border-top: none;
  padding-left: 4px;
}

.gg-card:not(.is-expanded) .gg-card-body-wrap {
  display: none;
}

/* Sub-disclosure (Prompt Templates inside Guided Scene settings) */
.gg-sub-disclosure {
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.12));
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gg-sub-disclosure-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  padding: 4px 2px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.gg-sub-disclosure-btn:hover {
  color: var(--lumiverse-text, currentColor);
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
}

.gg-sub-disclosure-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gg-sub-disclosure:not(.is-expanded) .gg-sub-disclosure-body {
  display: none;
}

/* Media Localizer-Style Clean Tick Boxes (replaces toggle switches) */
.gg-checkbox-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border-neutral, var(--lumiverse-border, rgba(255, 255, 255, 0.08)));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.025));
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease);
}

.gg-checkbox-row:hover {
  border-color: var(--lumiverse-border, rgba(147, 112, 219, 0.24));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.045));
}

.gg-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  cursor: pointer;
  user-select: none;
}

.gg-checkbox {
  width: 14px;
  height: 14px;
  margin: 0;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
}

.gg-checkbox:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.gg-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.gg-field-label {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--lumiverse-text, var(--text-primary, rgba(229, 231, 235, 0.88)));
}

/* Compact Buttons & Inputs */
.gg-btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 3.5px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.06));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.gg-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, var(--lumiverse-bg-hover, rgba(255, 255, 255, 0.12)));
  border-color: var(--lumiverse-border-hover, rgba(147, 112, 219, 0.34));
}

.gg-btn-sm:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.gg-btn-sm.is-primary {
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  color: var(--lumiverse-primary-contrast, #ffffff);
  font-weight: 600;
}

.gg-btn-sm.is-primary:hover:not(:disabled) {
  background: var(--lumiverse-primary-hover, var(--lumiverse-primary, rgba(167, 132, 239, 0.95)));
  border-color: var(--lumiverse-primary-hover, var(--lumiverse-primary, rgba(167, 132, 239, 0.95)));
}

.gg-btn-sm.is-danger {
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.15));
  border-color: var(--lumiverse-danger-050, rgba(239, 68, 68, 0.4));
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
}

.gg-btn-sm.is-danger:hover:not(:disabled) {
  background: var(--lumiverse-danger-020, rgba(239, 68, 68, 0.24));
  border-color: var(--lumiverse-danger, #ef4444);
}

.gg-btn-sm.is-xs {
  padding: 2px 6px;
  font-size: 10.5px;
}

.gg-input-sm {
  width: 100%;
  box-sizing: border-box;
  padding: 4.5px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.2));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill, rgba(0, 0, 0, 0.14)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font: inherit;
  font-size: 11.5px;
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.gg-input-sm::placeholder {
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(156, 163, 175, 0.6)));
}

.gg-input-sm:focus {
  outline: none;
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-015, rgba(147, 112, 219, 0.14));
}

.gg-input-sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Badges & Status Pills */
.gg-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.05));
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
  font-size: 10px;
  font-weight: 600;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}

.gg-badge.is-info {
  border-color: var(--lumiverse-primary-050, rgba(147, 112, 219, 0.36));
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16));
  color: var(--lumiverse-primary-text, var(--lumiverse-primary, #c4b5fd));
}

.gg-badge.is-warn {
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.38));
  background: var(--lumiverse-warning-015, rgba(245, 158, 11, 0.15));
  color: var(--lumiverse-warning-text, var(--lumiverse-warning, #f59e0b));
}

.gg-badge.is-success {
  border-color: var(--lumiverse-success-050, rgba(34, 197, 94, 0.35));
  background: var(--lumiverse-success-015, rgba(34, 197, 94, 0.15));
  color: var(--lumiverse-success-text, var(--lumiverse-success, #22c55e));
}

/* Sticky Armed Steering Banner */
.gg-scene-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.gg-armed-banner {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 9px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-primary-050, rgba(147, 112, 219, 0.44));
  background:
    linear-gradient(
      0deg,
      var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16)),
      var(--lumiverse-primary-015, rgba(147, 112, 219, 0.16))
    ),
    var(--lumiverse-bg-deep, var(--lumiverse-bg-elevated, var(--bg-secondary, #18181f)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}

.gg-armed-banner.is-paused {
  border-color: var(--lumiverse-warning-050, rgba(245, 158, 11, 0.44));
  background:
    linear-gradient(
      0deg,
      var(--lumiverse-warning-015, rgba(245, 158, 11, 0.15)),
      var(--lumiverse-warning-015, rgba(245, 158, 11, 0.15))
    ),
    var(--lumiverse-bg-deep, var(--lumiverse-bg-elevated, var(--bg-secondary, #18181f)));
}

.gg-armed-banner-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.gg-armed-banner-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
  font-size: 11.5px;
  font-weight: 600;
}

.gg-armed-banner-title > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gg-armed-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--lumiverse-primary, #a78bfa);
  box-shadow: 0 0 6px var(--lumiverse-primary-050, rgba(147, 112, 219, 0.6));
}

.gg-armed-banner.is-paused .gg-armed-dot {
  background: var(--lumiverse-warning, #f59e0b);
  box-shadow: 0 0 6px var(--lumiverse-warning-050, rgba(245, 158, 11, 0.55));
}

.gg-armed-banner-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

/* Guided Scene Workbench */
.gg-scene-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 6px;
  padding: 20px 12px;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
  font-size: 11.5px;
}

.gg-scene-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--lumiverse-primary-015, rgba(147, 112, 219, 0.14));
  color: var(--lumiverse-primary, #a78bfa);
}

.gg-scene-empty-icon svg {
  width: 15px;
  height: 15px;
}

.gg-scene-header-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.gg-scene-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 8px;
  align-items: start;
}

.gg-scene-grid-2 > .is-span-2 {
  grid-column: 1 / -1;
}

.gg-scene-compact-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.7)));
  letter-spacing: 0.02em;
}

.gg-checkbox-row.is-compact {
  padding: 3.5px 7px;
}

.gg-scene-preview-ta {
  width: 100%;
  box-sizing: border-box;
  min-height: 88px;
  max-height: 220px;
  resize: vertical;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.14)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.45;
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.gg-scene-preview-ta::placeholder {
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(156, 163, 175, 0.6)));
}

.gg-scene-preview-ta:focus {
  outline: none;
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-015, rgba(147, 112, 219, 0.14));
}

.gg-scene-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.gg-scene-preview-title-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.gg-scene-preview-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

/* Expandable Textarea (Lumiverse ExpandableTextarea parity) */
.gg-expandable-ta {
  position: relative;
  width: 100%;
  min-width: 0;
}

.gg-expandable-ta-slot {
  width: 100%;
  min-width: 0;
}

.gg-expandable-ta-slot textarea {
  padding-right: 34px;
  box-sizing: border-box;
}

.gg-expandable-ta-fallback {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 34px 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.18));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.14)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.45;
  resize: vertical;
}

.gg-ta-expand-btn {
  position: absolute;
  top: 5px;
  right: 8px;
  width: var(--lumiverse-btn-icon-sm, 24px);
  height: var(--lumiverse-btn-icon-sm, 24px);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--lumiverse-bg-deep, var(--lumiverse-bg-elevated, var(--bg-secondary, var(--lumiverse-bg, #0f0d15))));
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.14));
  color: var(--lumiverse-text-dim, rgba(255, 255, 255, 0.55));
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
  z-index: 2;
  padding: 0;
}

.gg-expandable-ta:hover .gg-ta-expand-btn:not(:disabled),
.gg-expandable-ta:focus-within .gg-ta-expand-btn:not(:disabled) {
  opacity: 1;
}

@media (any-hover: none) {
  .gg-ta-expand-btn:not(:disabled) {
    opacity: 0.7;
  }
}

.gg-ta-expand-btn:hover:not(:disabled) {
  color: var(--lumiverse-primary, #c4b5fd);
  border-color: var(--lumiverse-primary, #c4b5fd);
}

.gg-ta-expand-btn:disabled {
  opacity: 0;
  pointer-events: none;
}

/* Expanded Textarea Modal Content (mounted inside ctx.ui.showModal) */
.gg-expanded-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: min(560px, calc(70vh - 120px));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: var(--lumiverse-font-family, inherit);
  font-size: 12px;
}

.gg-expanded-editor-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.gg-expanded-editor-ta {
  width: 100%;
  flex: 1 1 auto;
  min-height: min(460px, calc(70vh - 200px));
  box-sizing: border-box;
  resize: vertical;
  padding: 10px 12px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.22));
  background: var(--lumiverse-input-bg, var(--lumiverse-fill-subtle, rgba(0, 0, 0, 0.16)));
  color: var(--lumiverse-text, var(--text-primary, currentColor));
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.55;
  scrollbar-width: thin;
  scrollbar-color: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.22)) transparent;
}

@media (max-width: 640px), (max-height: 600px) {
  .gg-expanded-editor {
    min-height: min(340px, 55vh);
  }
  .gg-expanded-editor-ta {
    min-height: min(240px, 40vh);
  }
}

.gg-expanded-editor-ta::placeholder {
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(156, 163, 175, 0.6)));
}

.gg-expanded-editor-ta:focus {
  outline: none;
  border-color: var(--lumiverse-primary, rgba(147, 112, 219, 0.6));
  box-shadow: 0 0 0 2px var(--lumiverse-primary-015, rgba(147, 112, 219, 0.14));
}

.gg-expanded-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
  flex-wrap: wrap;
}

.gg-expanded-editor-footer-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.gg-expanded-editor-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.gg-expanded-editor-counts {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

/* Fallback Modal Overlay (only when host lacks ctx.ui.showModal) */
.gg-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(2px);
}

.gg-modal-dialog {
  display: flex;
  flex-direction: column;
  width: min(860px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 32px));
  border-radius: 10px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.26));
  background: var(--lumiverse-bg-deep, var(--bg-secondary, #18181f));
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.gg-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
}

.gg-modal-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.gg-modal-content {
  padding: 12px 14px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.gg-scene-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.14));
}

.gg-scene-primary-btn {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6.5px 12px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  background: var(--lumiverse-primary, rgba(147, 112, 219, 0.9));
  color: var(--lumiverse-primary-contrast, #ffffff);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    border-color var(--lumiverse-transition-fast, 150ms ease),
    opacity var(--lumiverse-transition-fast, 150ms ease);
}

.gg-scene-primary-btn:hover:not(:disabled) {
  background: var(--lumiverse-primary-hover, var(--lumiverse-primary, rgba(167, 132, 239, 0.95)));
  border-color: var(--lumiverse-primary-hover, var(--lumiverse-primary, rgba(167, 132, 239, 0.95)));
}

.gg-scene-primary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gg-scene-stop-btn {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6.5px 12px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-danger-050, rgba(239, 68, 68, 0.5));
  background: var(--lumiverse-danger-015, rgba(239, 68, 68, 0.16));
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.gg-scene-stop-btn:hover {
  background: var(--lumiverse-danger-020, rgba(239, 68, 68, 0.25));
}

.gg-spinner {
  width: 11px;
  height: 11px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  display: inline-block;
  animation: gg-spin 0.8s linear infinite;
}

@keyframes gg-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Recovery & Order Lists (Minimalist Flat Rows) */
.gg-recovery-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}

.gg-recovery-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.12));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
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
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.6)));
}

.gg-recovery-snippet {
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gg-order-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.12));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.03));
}

.gg-order-item-left {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}

.gg-order-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, currentColor));
}

.gg-order-item-icon svg {
  width: 13px;
  height: 13px;
  display: block;
}

.gg-order-item-label {
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gg-order-item-state {
  font-size: 10px;
  color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, rgba(229, 231, 235, 0.55)));
}

.gg-order-item-controls {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.gg-icon-btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 5px;
  border: 1px solid var(--lumiverse-border, rgba(147, 112, 219, 0.16));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.05));
  color: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.gg-icon-btn-sm:hover:not(:disabled) {
  background: var(--lumiverse-fill-hover, rgba(255, 255, 255, 0.12));
}

.gg-icon-btn-sm:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Drop-Up Quick Menu (portaled to document.body) */
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
  min-height: 34px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--lcs-radius-xs, 6px);
  background: transparent;
  color: var(--lumiverse-text, var(--text-primary, #e5e7eb));
  font: inherit;
  font-size: 12.5px;
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

.gg-dropup-item.is-danger {
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
}

.gg-dropup-item svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  pointer-events: none;
  display: block;
  color: var(--lumiverse-primary, var(--accent-primary, currentColor));
}

.gg-dropup-item.is-danger svg {
  color: var(--lumiverse-danger-text, var(--lumiverse-danger, #ef4444));
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
  min-width: min(220px, 100%);
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

.gg-streaming-indicator--optimistic {
  padding: 8px 16px;
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
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.4));
  color: var(--lumiverse-danger-contrast, var(--lumiverse-primary-contrast, #fff));
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
    0 0 0 3px var(--lumiverse-warning-020, var(--lumiverse-warning-015, rgba(245, 158, 11, 0.24))),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-running::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid var(--lumiverse-primary-050, rgba(139, 92, 246, 0.45));
  pointer-events: none;
  will-change: transform, opacity;
  animation: gg-chat-head-pulse 1.5s ease-in-out infinite;
}

.gg-chat-head.is-streaming {
  border-color: var(--lumiverse-primary, #8b5cf6);
  box-shadow:
    0 0 0 3px var(--lumiverse-primary-020, rgba(139, 92, 246, 0.28)),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.gg-chat-head.is-completed {
  border-color: var(--lumiverse-success, #22c55e);
  box-shadow:
    0 0 0 3px var(--lumiverse-success-020, var(--lumiverse-success-015, rgba(34, 197, 94, 0.3))),
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
  .gg-chat-head,
  .gg-chat-head.is-running::after,
  .gg-chat-head-dismiss,
  .gg-card-chevron,
  .gg-dropup-item,
  .gg-drawer-nav-btn,
  .gg-subnav-btn,
  .gg-spinner {
    animation: none !important;
    transition: none !important;
  }
}
`;var qn="pending:",zi=200,$i=100,ji=50,Wi=500,qi=1e4,sn=300000;class on extends Error{constructor(e){super(`Timed out waiting for ${e}.`);this.name="RpcTimeoutError"}}function Xi(e){if(e instanceof on)return!0;let t=e instanceof Error?e.message:String(e);return/^Timed out waiting for /i.test(t)||/^Timeout waiting for /i.test(t)}function Oe(e){return typeof e==="string"&&e.startsWith(qn)}function ot(e){return Boolean(e)&&typeof e==="object"&&!Array.isArray(e)}function We(e){return ot(e)&&typeof e.chatId==="string"&&e.chatId.length>0&&typeof e.status==="string"&&typeof e.pacing==="string"}function je(e){if(We(e))return e;if(ot(e)&&"armedScene"in e)return We(e.armedScene)?e.armedScene:null;return null}function Te(e,t){if(Object.is(e,t))return!0;if(typeof e!==typeof t||e===null||t===null)return!1;if(typeof e!=="object")return!1;if(Array.isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let d=0;d<e.length;d+=1)if(!Te(e[d],t[d]))return!1;return!0}let n=e,i=t,r=Object.keys(n),s=Object.keys(i);if(r.length!==s.length)return!1;for(let d of r){if(!Object.prototype.hasOwnProperty.call(i,d))return!1;if(!Te(n[d],i[d]))return!1}return!0}function an(e){if(!ot(e))return null;if(typeof e.chatId==="string"&&e.chatId)return e.chatId;if(ot(e.chat)&&typeof e.chat.id==="string")return e.chat.id;return null}function Yi(e){let t=an(e);if(t)return t;if(ot(e)&&typeof e.id==="string"&&e.id)return e.id;return null}function Wn(e,t){if(!Array.isArray(t)||t.length===0)return e;return{...e,connections:t.map((n)=>({id:n.id,name:n.name,provider:n.provider??"",model:n.model??"",isDefault:Boolean(n.is_default)}))}}async function Zi(e,t){if(e.connections.length>0||!t.connections?.list)return e;try{let n=t.connections.list();if(n&&typeof n.then==="function"){let i=await n;return Wn(e,i)}return Wn(e,n)}catch{return e}}function kr(e){let t=e,n=t.dom.addStyle(jn),i=[],r=!1,s=0,d=0,u=0,o=0,m=0,c=0,h=0,S=!1,p=new Set,l=null,y=!1,E=!1,w=!1,H=null,M=null,x=new Map,B=new Map,T=new Map,I=new Set,v=new Map,A=new Map,G=[0,20,50,100,200],_,O=null,C=0,N,k,z=0,ee=null,j=null,oe=!1,pe=!1,ce=!1,X=!0,ge=!1,_e=null,we=!1;function F(){try{let a=t.getActiveChat?.();return{chatId:typeof a?.chatId==="string"&&a.chatId?a.chatId:null,...a?.characterId!==void 0?{characterId:a.characterId}:{}}}catch{return{chatId:null}}}function Fe(){try{return t.connections?.getActive?.()?.activeProfileId??null}catch{return null}}let he=F().chatId;function Ee(a){if(!a)return null;return B.get(a)??null}function me(a,g){if(a)if(g&&g.chatId===a)B.set(a,g);else B.delete(a);let f=F().chatId;R.setArmedScene(Ee(f),f),ue()}function lt(a){let g=Array.isArray(a.armedScenes),f=a.armedScene!==void 0;if(!g&&!f)return;if(g){B.clear();for(let b of a.armedScenes)if(We(b))B.set(b.chatId,b)}if(We(a.armedScene))B.set(a.armedScene.chatId,a.armedScene);else if(!g&&a.armedScene===null){let b=F().chatId;if(b)B.delete(b)}}function re(a){if(!a||Oe(a))return;if(I.has(a))I.delete(a);else if(I.size>=$i){let g=I.values().next().value;if(g!==void 0)I.delete(g)}I.add(a)}function L(){if(k!==void 0)clearInterval(k),k=void 0}function J(){if(r||x.size===0){L();return}if(k!==void 0)return;k=setInterval(()=>{if(r||x.size===0){L();return}if(typeof document<"u"&&document.visibilityState==="hidden")return;se({onlyIfChanged:!0})},qi)}function ke(){if(r)return;if(x.size===0&&T.size===0)return;let a=Date.now();if(a-z<Wi)return;z=a,se({onlyIfChanged:!0})}function fe(a,g){if(v.has(a))v.delete(a);else if(v.size>=zi){let f=v.keys().next().value;if(f!==void 0)v.delete(f)}v.set(a,g)}try{ee=t.ui.mount("chat_composer_above")}catch{ee=null}function le(a){if(!a)return null;return x.get(a)??(M?.chatId===a?M:null)}function Ae(a){if(!a)return!1;return Boolean(le(a))||p.has(a)}function qe(){let a=F().chatId;if(a&&x.has(a)){M=x.get(a);return}let g=null;for(let f of x.values())if(!g||f.startedAt>=g.startedAt)g=f;M=g}function ln(a,g,f){let b={runId:`${qn}${++d}`,actionId:a,chatId:g,startedAt:Date.now(),...f?.backgroundSwipe?{backgroundSwipe:!0}:{}};if(c+=1,z=0,fe(g,c),x.set(g,b),J(),qe(),l)l={...l,activeRun:M};let P=F().chatId,D=le(P);return Ue.sync(D),R.setSceneActiveRun(D),ue(),b}function Re(a,g){let f=x.get(a);if(!f||f.runId!==g)return!1;if(c+=1,fe(a,c),x.delete(a),J(),qe(),l)l={...l,activeRun:M};if(!r){let b=F().chatId,P=le(b);Ue.sync(P),R.setSceneActiveRun(P),ue()}return!0}function Pe(){if(_!==void 0)clearTimeout(_),_=void 0;O=null,C=0}function Xn(a){if(r)return;if(O!==a)Pe(),O=a,C=0;if(_!==void 0)return;let g=G[C];if(g===void 0)return;C+=1,_=setTimeout(()=>{if(_=void 0,r)return;Dt(a,{fromRetry:!0})},g)}function Lt(a,g){if(A.has(a))A.delete(a);else if(A.size>=ji){let f=A.keys().next().value;if(f!==void 0)A.delete(f)}A.set(a,g)}function Dt(a,g={}){if(r||!a)return;let f=A.get(a);if(f===void 0){if(O===a)Pe();return}let b=Le();if(F().chatId!==a){if(O===a)Pe();return}if(!De(b)||b.chatId!==a){if(!g.fromRetry)Pe();Xn(a);return}if(Pe(),b.text.trim().length>0){A.delete(a);return}if(Xe(f,b))A.delete(a),Ye(b)}function Le(){if(r)return null;try{return t.composer?.getState?.()??null}catch{return null}}function De(a){return Boolean(a)&&a.mounted!==!1}function Xe(a,g){if(r)return!1;let f=g!==void 0?g:Le();if(!De(f))return!1;try{return t.composer.setText(a),!0}catch{return!1}}function Ye(a){if(r)return!1;let g=a!==void 0?a:Le();if(!De(g))return!1;try{return t.composer.focus(),!0}catch{return!1}}let Ie=new Map;function te(a,g,f=30000,b){if(r)return Promise.reject(Error("Extension unloaded."));let P=`gg-${++s}-${Date.now().toString(36)}`;return new Promise((D,U)=>{let Y=setTimeout(()=>{Ie.delete(P),U(new on(a))},f);Ie.set(P,{resolve:(K)=>D(K),reject:U,timer:Y}),b?.(P),t.sendToBackend({type:"gg:rpc",requestId:P,action:a,input:g})})}function Z(a,g="info",f=5000){if(r)return;if(R.setNotice(a,g),N)clearTimeout(N),N=void 0;if(ee)if(!a)ee.replaceChildren();else{let b=document.createElement("div");if(b.className=`gg-notice${g==="error"?" is-error":g==="warn"?" is-warn":""}`,g==="error"||g==="warn")b.setAttribute("role","alert"),b.setAttribute("aria-live","assertive");else b.setAttribute("role","status"),b.setAttribute("aria-live","polite");b.style.margin="4px 12px",b.textContent=a,ee.replaceChildren(b)}if(a&&f>0)N=setTimeout(()=>{if(N=void 0,r)return;R.setNotice("","info"),ee?.replaceChildren()},f)}function Ne(){if(N)clearTimeout(N),N=void 0;if(r)return;R.setNotice("","info"),ee?.replaceChildren()}function dn(){if(r)return;let{chatId:a}=F();R.setRecoveryBusy(Ae(a))}function St(){if(H)H(),H=null}function ue(){if(r||!l)return;let{chatId:a}=F();gn.render({settings:l.settings,activeRun:le(a),isBusy:Ae(a),recovery:l.recovery,hasActiveChat:Boolean(a),chatId:a,armedScene:Ee(a)}),dn()}function ye(){if(r)return;if(l)ue();else dn()}async function Me(a={}){if(r)return;if(!a.force&&!R.isShowingGuidedScene())return;let{chatId:g}=F(),f=++o;if(!g){R.setSceneLoading(!1),R.setSceneContext(null,null);return}R.setSceneLoading(!0);try{let b=await te("get_scene_context",{chatId:g});if(r||f!==o||F().chatId!==g)return;if(b&&typeof b.chatId==="string")if(b.armedScene)B.set(b.chatId,b.armedScene);else B.delete(b.chatId);R.setSceneLoading(!1),R.setSceneContext(b,null),ue()}catch(b){if(r||f!==o||F().chatId!==g)return;R.setSceneLoading(!1);let P=b instanceof Error?b.message:String(b);R.setSceneContext(null,P)}}async function Yn(a){if(r||!l)return;let g=mt(l.settings.guidedScene),f={...l.settings,guidedScene:{...g,...a}},b=++m;l={...l,settings:f},R.syncSettings(f),ue();try{let P=await te("save_settings",f);if(r||!l||b!==m)return;let D=Te(P,l.settings);if(l={...l,settings:P},!D)R.syncSettings(P),ue()}catch(P){if(r)return;if(Z(`Failed saving settings: ${P instanceof Error?P.message:String(P)}`,"error"),b===m)se()}}function cn(a){if(r)return;if(Oe(a)){let g=F().chatId,b=((g?x.get(g):void 0)??Array.from(x.values()).find((P)=>P.runId===a))?.chatId??g;if(b)Re(b,a),te("abort_action",{chatId:b}).catch(()=>{return});return}te("abort_action",{runId:a}).then((g)=>{if(r)return;if(!g?.aborted)se({onlyIfChanged:!0})},()=>{if(r)return;se({onlyIfChanged:!0})})}async function un(a){if(r)throw Error("Extension unloaded.");let g=a.chatId;if(!g)throw Error("Open a chat before dropping a scene.");if(Ae(g))throw Error("Wait for the active guided run to finish first.");let f=Boolean(a.draftLocked)&&Boolean((a.lockedDraftText??a.previewText)?.trim()),b=a.delivery!=="cut"&&a.adjustmentMode==="verbatim"&&!f,P=a.adjustmentMode!=="verbatim"&&!f,D=b||P;p.add(g);let U=D?ln("guided_scene",g):null;if(!D)ye();let Y=!1,K="",de={requestId:"",actionId:"guided_scene",chatId:g,startedAt:Date.now(),observedRunId:null,cancelAsReconciled:()=>{if(Y)return;Y=!0;let q=Ie.get(K);if(q)Ie.delete(K),clearTimeout(q.timer),q.resolve(void 0);if(T.get(g)===de)T.delete(g);if(p.delete(g),U)Re(g,U.runId);ye()}};try{Ne();let q=await te("drop_scene_now",a,sn,(Q)=>{K=Q,de.requestId=Q,T.set(g,de)});if(T.get(g)===de)T.delete(g);if(U)Re(g,U.runId);if(!r&&!Y&&y&&R.isShowingGuidedScene())Me();return q}catch(q){if(T.get(g)===de)T.delete(g);if(U)Re(g,U.runId);if(!r&&!Y&&le(g))se({onlyIfChanged:!0});throw q}finally{if(T.get(g)===de)T.delete(g);if(p.delete(g),U)Re(g,U.runId);ye()}}function Zn(){if(r)return;let a=null;try{a=t.ui?.events?.getDrawerState?.()??null}catch{a=null}if(Boolean(a?.open)&&a?.tabId===R.getTabId()&&R.isShowingGuidedScene()){te("close_drawer").catch(()=>{return});return}let f=R.isShowingGuidedScene();if(R.openGuidedScene(),!y)y=!0,St(),R.render(l);w=!0;try{R.activate()}finally{w=!1}if(!E)se({onlyIfChanged:!1,includeCatalogs:!0});if(f)Me({force:!0})}async function Jn(){if(r)return;let{chatId:a}=F();if(!a)return;try{let g=await te("drop_next_turn",{chatId:a});if(r)return;me(a,je(g)),Z("Guided Scene set to drop on the next turn.","info")}catch(g){if(r)return;Z(g instanceof Error?g.message:String(g),"error",7000)}}async function Qn(){if(r)return;let{chatId:a}=F();if(!a)return;let g=Ee(a);if(!g)return;try{await un({chatId:a,greetingSource:g.greetingSource,selectedGreetingKey:g.selectedGreetingKey??null,greetingLabel:g.greetingLabel,rawGreetingText:g.rawGreetingText,speakerCharacterId:g.speakerCharacterId??null,speakerCharacterName:g.speakerCharacterName??null,delivery:g.delivery,transitionNote:g.transitionNote,adjustmentMode:g.adjustmentMode,customDirection:g.customDirection,keepMediaIntact:g.keepMediaIntact??l?.settings.guidedScene?.keepMediaIntact??!0,draftLocked:g.draftLocked,lockedDraftText:g.lockedDraftText,previewText:g.lockedDraftText??void 0,dropTarget:"new_message",activeConnectionId:Fe()})}catch(f){if(r)return;Z(f instanceof Error?f.message:String(f),"error",7000)}}async function ei(){if(r)return;let{chatId:a}=F();if(!a)return;let g=Ee(a);if(!g)return;let f=g.status==="paused"?"resume_scene":"pause_scene";try{let b=await te(f,{chatId:a});if(r)return;me(a,je(b))}catch(b){if(r)return;Z(b instanceof Error?b.message:String(b),"error",7000)}}async function ti(){if(r)return;let{chatId:a}=F();if(!a)return;try{if(await te("cancel_scene",{chatId:a}),r)return;me(a,null)}catch(g){if(r)return;Z(g instanceof Error?g.message:String(g),"error",7000)}}async function se(a={}){if(r)return!1;if(!y&&R.isTabConnected())y=!0,St(),R.render(l);let g=y&&R.isTabConnected(),f=a.includeCatalogs!==void 0?Boolean(a.includeCatalogs):y&&(!E||g);if(j&&(!f||oe)){if(ce=!0,X=X&&Boolean(a.onlyIfChanged),ge=ge||f,a.fresh){if(await j,r)return!1;if(j)return j;return se({onlyIfChanged:a.onlyIfChanged,includeCatalogs:f,fresh:!1})}return j}let b;return b=(async()=>{let P=++u,D=m,U=c;try{let Y=await te("get_bootstrap",{includeCatalogs:f});if(r)return!1;if(P!==u){if(j&&j!==b)return j;return pe}let K=f?await Zi(Y,t):Y;if(r)return!1;if(P!==u){if(j&&j!==b)return j;return pe}let de=l&&m!==D?l.settings:K.settings;lt(K);let q=new Map,Q=K.activeRuns;if(Array.isArray(Q)){for(let V of Q)if(V&&typeof V.chatId==="string"&&V.chatId.length>0)q.set(V.chatId,V)}if(K.activeRun&&typeof K.activeRun.chatId==="string"&&K.activeRun.chatId.length>0)q.set(K.activeRun.chatId,K.activeRun);let ne=new Map;for(let[V,W]of x.entries())if(!Oe(W.runId))ne.set(V,W.runId);let Ce=K.recentTerminalRuns,Ke=Array.isArray(Ce)?Ce:[];for(let[V,W]of q.entries())if(!Oe(W.runId)){let Se=T.get(V);if(Se)Se.observedRunId=W.runId}let bn=new Map;for(let[V,W]of x.entries())if(Oe(W.runId)&&p.has(V))bn.set(V,W);if(c===U){x.clear();for(let[V,W]of q.entries())x.set(V,W)}else if(h<=U){for(let V of[...x.keys()])if((v.get(V)??0)<=U){let W=q.get(V);if(W)x.set(V,W);else x.delete(V)}for(let[V,W]of q.entries())if(!x.has(V)&&(v.get(V)??0)<=U)x.set(V,W)}for(let[V,W]of[...T.entries()]){if((v.get(V)??0)>U)continue;let Se=q.get(V),xn=ne.get(V)??null,wn=Ke.find((Et)=>W.observedRunId!==null?Et.runId===W.observedRunId:Et.chatId===V&&Et.actionId===W.actionId&&Et.finishedAt>=W.startedAt);if(wn!==void 0&&(!Se||Se.runId!==wn.runId)||W.observedRunId!==null&&(!Se||Se.runId!==W.observedRunId)||xn!==null&&(!Se||Se.runId!==xn))W.cancelAsReconciled()}for(let[V,W]of bn.entries())if(!x.has(V)&&p.has(V)&&T.has(V))x.set(V,W);J(),qe();let yn=M,be=l,Ht=null;if(Ke.length>0)if(be===null)for(let V of Ke)re(V.runId);else{let V=[...Ke].sort((W,Se)=>W.finishedAt-Se.finishedAt);for(let W of V){if(I.has(W.runId))continue;if(re(W.runId),W.status==="error"&&typeof W.error==="string"&&W.error.length>0)Ht=W.error}}let ze={...K,settings:de,activeRun:yn,...!f&&E&&be!==null?{connections:be.connections,presets:be.presets,catalogWarnings:be.catalogWarnings}:{}},ai=f&&!E;if(f)E=!0;let oi=y&&Boolean(a.onlyIfChanged)&&!ai&&be!==null&&Te(be.settings,ze.settings)&&Te(be.connections,ze.connections)&&Te(be.presets,ze.presets)&&Te(be.permissions,ze.permissions)&&Te(be.catalogWarnings??[],ze.catalogWarnings??[]);l=ze,M=yn;let wt=F().chatId,Sn=le(wt);if(Ue.sync(Sn),R.setSceneActiveRun(Sn),R.setArmedScene(Ee(wt),wt),dt.syncRuns(Array.from(x.values()).filter((V)=>!Oe(V.runId)),wt),y){if(!oi)R.render(l);else if(!Te(be.recovery,ze.recovery))R.updateRecovery(l.recovery,l.settings)}if(ue(),Ht)Z(Ht,"error",7000);return pe=!0,!0}catch(Y){if(r)return!1;pe=!1;let K=Y instanceof Error?Y.message:String(Y);return Z(K,"error"),!1}finally{if(j===b){if(j=null,oe=!1,ce&&!r){let Y=X,K=ge;ce=!1,X=!0,ge=!1,se({onlyIfChanged:Y,includeCatalogs:K})}}}})(),j=b,oe=f,b}async function pn(a){let{rpcAction:g,actionId:f,chatId:b,payload:P,backgroundSwipe:D,onRollback:U}=a,Y=ln(f,b,{backgroundSwipe:D}),K=!1,de="",q={requestId:"",actionId:f,chatId:b,startedAt:Date.now(),observedRunId:null,cancelAsReconciled:()=>{if(K)return;K=!0;let Q=Ie.get(de);if(Q)Ie.delete(de),clearTimeout(Q.timer),Q.resolve(void 0);if(T.get(b)===q)T.delete(b);p.delete(b),Re(b,Y.runId),ye()}};try{let Q=await te(g,P,sn,(Ke)=>{de=Ke,q.requestId=Ke,T.set(b,q)});if(T.get(b)===q)T.delete(b);if(r||K)return;let ne=Q&&typeof Q==="object"&&typeof Q.runId==="string"?Q.runId:q.observedRunId;if(ne)re(ne);Re(b,Y.runId);let Ce=x.get(b);if(Ce&&!Oe(Ce.runId)&&(!ne||Ce.runId===ne))se({onlyIfChanged:!0})}catch(Q){if(T.get(b)===q)T.delete(b);if(Re(b,Y.runId),r||K)return;let ne=Q instanceof Error?Q.message:String(Q);if(Xi(Q)){let Ce=await se({onlyIfChanged:!0,fresh:!0});if(r)return;if(!Ce)U?.(),Z(ne,"error",7000);return}if(q.observedRunId)re(q.observedRunId);if(U?.(),Z(ne,"error",7000),le(b))se({onlyIfChanged:!0})}finally{if(T.get(b)===q)T.delete(b);Re(b,Y.runId)}}async function ni(a,g){if(r||S)return;let f=F().chatId;if(f&&(le(f)||p.has(f)))return;S=!0;let b=f;if(b)p.add(b),ye();try{if(!l)await se();if(S=!1,r||!l)return;let{chatId:P}=F();if(!P){Z("Open a chat before triggering a guided action.","warn");return}if(b!==P){if(b)p.delete(b);if(p.has(P))return;b=P,p.add(b),ye()}if(le(P))return;let D=Le();if(!De(D)){Z("Composer is unavailable right now. Open the message input bar and try again.","warn");return}if(D.chatId!==null&&D.chatId!==P){Z("Active chat changed; please try again.","warn");return}let U=D.text,Y=l.settings.actions[a];if(a==="guided_response"&&!U.trim()){Z("Type guidance in the input box before clicking Guided Response.","warn"),Ye();return}Ne(),A.delete(P);let K=Boolean(U.trim())&&(Y.clearInputOnRun||a==="guided_impersonate");if(K&&!Xe("")){Z("Composer is unavailable right now.","warn");return}let de=Fe(),q=a==="guided_swipe"&&Boolean(g?.backgroundSwipe),Q={actionId:a,chatId:P,activeConnectionId:de,inputText:U,...q?{backgroundSwipe:!0}:{}};await pn({rpcAction:"run_action",actionId:a,chatId:P,payload:Q,backgroundSwipe:q,onRollback:()=>{if(K&&!le(P)){let ne=Le(),Ce=F().chatId;if(De(ne)&&ne.chatId===P&&Ce===P&&!ne.text)Xe(U)}}})}finally{if(S=!1,b)p.delete(b);ye()}}function Nt(a){let g=F().chatId;if(r||!l)return;if(Ae(g)){Z("Wait for the active guided generation to finish before restoring input.","warn");return}let f=Le();if(!De(f)){Z("Composer is unavailable right now — cannot restore input.","warn");return}if(f.chatId!==null&&f.chatId!==g){Z("Active chat changed; please try again.","warn");return}if(!Xe(a.text)){Z("Composer is unavailable right now — cannot restore input.","warn");return}Ye(),Ne()}function ii(){let a=F().chatId;if(r||!l||Ae(a))return;if(!l.settings.inputRecovery.enabled)return;let g=Le();if(!De(g)){Z("Composer is unavailable right now — cannot clear input.","warn");return}if(g.chatId!==null&&g.chatId!==a){Z("Active chat changed; please try again.","warn");return}if(!g.text){Ye(),Ne();return}if(!Xe("")){Z("Composer is unavailable right now — cannot clear input.","warn");return}Ye(),Ne()}async function ri(){if(r||S)return;let{chatId:a}=F();if(!a){Z("Open a chat before removing the last continue.","warn");return}if(Ae(a))return;p.add(a),ye(),A.delete(a);try{Ne(),await te("remove_last_continue",{chatId:a})}catch(g){if(r)return;let f=g instanceof Error?g.message:String(g);Z(f,"warn",7000)}finally{p.delete(a),ye()}}async function si(){if(r||S)return;let{chatId:a}=F();if(!a){Z("Open a chat before regenerating the last continue.","warn");return}if(Ae(a))return;p.add(a),ye(),A.delete(a);try{Ne();let g=Fe();await pn({rpcAction:"regenerate_last_continue",actionId:"guided_continue",chatId:a,payload:{chatId:a,activeConnectionId:g}})}finally{p.delete(a),ye()}}async function hn(){let a=F().chatId;if(r)return;if(Ae(a)){Z("Wait for the active guided generation to finish before clearing input recovery history.","warn");return}try{let g=await te("clear_recovery");if(r)return;if(l){if(l={...l,recovery:g},ue(),y)R.updateRecovery(l.recovery,l.settings)}}catch(g){if(r)return;Z(g instanceof Error?g.message:String(g),"error")}}let Ue=new rn(t),dt=new qt(t),Ve=new en(t),gn=new Qt(t,{onTriggerAction:(a,g)=>{ni(a,g)},onAbortAction:(a)=>{cn(a)},onRestoreLatest:()=>{let a=F().chatId;if(r||!l||Ae(a))return;let g=Pn(l.recovery);if(g)Nt(g);else ii()},onRestoreEntry:(a)=>{Nt(a)},onClearRecovery:()=>{hn()},onRemoveLastContinue:()=>{ri()},onRegenerateLastContinue:()=>{si()},onToggleSceneDrawer:()=>{Zn()},onSceneDropNextTurn:()=>{Jn()},onSceneDropNow:()=>{Qn()},onSceneTogglePause:()=>{ei()},onSceneCancelSteering:()=>{ti()}}),R=new nn(t,{onRefresh:()=>{if(r)return;if(Ne(),se({includeCatalogs:!0}),R.isShowingGuidedScene())Me()},onSaveSettings:async(a,g)=>{if(r||!l)return;let f=++m;if(l={...l,settings:a},ue(),g?.rebuildDrawer)R.render(l,{force:!0});try{let b=await te("save_settings",a);if(r||!l||f!==m)return;let P=Te(b,l.settings);if(l={...l,settings:b},!P)if(ue(),g?.rebuildDrawer)R.render(l);else R.syncSettings(b)}catch(b){if(r)return;if(Z(`Failed saving settings: ${b instanceof Error?b.message:String(b)}`,"error"),f===m)se()}},onRestoreEntry:(a)=>Nt(a),onClearRecovery:()=>hn(),onActiveViewChange:(a,g)=>{if(r)return;if(R.isShowingGuidedScene())Me({force:!0})},scene:{onRefreshContext:async()=>{await Me({force:!0})},onSaveSceneConfigPatch:async(a)=>{await Yn(a)},onPreviewDraft:async(a)=>te("preview_scene_draft",a,sn),onCancelPreview:(a)=>{te("abort_action",{chatId:a}).catch(()=>{return})},onAbortRun:(a)=>{cn(a)},onDropSceneNow:async(a)=>un(a),onArmScene:async(a)=>{let g=await te("arm_scene",a),f=je(g);if(!r)me(a.chatId,f);return f},onUpdateArmedScene:async(a)=>{let g=await te("update_armed_scene",a),f=je(g);if(!r)me(a.chatId,f);return f},onPauseScene:async(a)=>{let g=await te("pause_scene",{chatId:a}),f=je(g);if(!r)me(a,f);return f},onResumeScene:async(a)=>{let g=await te("resume_scene",{chatId:a}),f=je(g);if(!r)me(a,f);return f},onDropNextTurn:async(a)=>{let g=await te("drop_next_turn",{chatId:a}),f=je(g);if(!r)me(a,f);return f},onCancelScene:async(a)=>{if(await te("cancel_scene",{chatId:a}),!r)me(a,null)},getActiveConnectionId:()=>Fe()}});y=R.isTabConnected();function mn(){if(r)return;if(St(),!y)y=!0,R.render(l);if(se({onlyIfChanged:E,includeCatalogs:!0}),!w&&R.isShowingGuidedScene())Me()}if(!y)H=R.observeTabConnection(()=>{mn()}),i.push(()=>{St()});function xt(a){if(r)return;let g=F().chatId,f=a!==void 0?a:g,b=`${g??""}\x00${f??""}`;if(b===_e)return;if(_e=b,he=g,!we)we=!0,queueMicrotask(()=>{we=!1,_e=null});Pe(),qe();let P=le(g);if(Ue.sync(P),R.setSceneActiveRun(P),R.setArmedScene(Ee(g),g),dt.onChatChanged(g),ue(),Dt(g),Ve.onChatChanged(f),o+=1,y&&R.isTabConnected()&&R.isShowingGuidedScene())Me();else R.setSceneLoading(!1),R.setSceneContext(null,null)}i.push(R.onActivate(()=>{mn()})),i.push(t.onBackendMessage((a)=>{if(r)return;let g=ot(a)?a:{};if(g.type==="gg:reply"&&typeof g.requestId==="string"){let b=Ie.get(g.requestId);if(!b)return;if(Ie.delete(g.requestId),clearTimeout(b.timer),typeof g.error==="string"&&g.error)b.reject(Error(g.error));else b.resolve(g.result);return}let f=g;switch(f.type){case"gg:status":{c+=1;let b=F().chatId,P=le(b),D=typeof f.chatId==="string"&&f.chatId.length>0?f.chatId:void 0,U=Boolean(f.done)||Boolean(f.aborted)||Boolean(f.error),Y=D===void 0&&U&&Boolean(f.error),K=D?x.get(D):void 0,de=f.run?x.get(f.run.chatId):void 0;if(f.run){if(D&&f.run.chatId!==D&&U){if(re(K?.runId),re(T.get(D)?.observedRunId),x.delete(D),fe(D,c),K!==void 0&&K.actionId!=="guided_impersonate"||f.aborted||f.error)A.delete(D)}if(!U||Y||D!==void 0&&f.run.chatId!==D){if(de?.runId!==f.run.runId)A.delete(f.run.chatId),z=0;if(!Oe(f.run.runId)){let ne=T.get(f.run.chatId);if(ne)ne.observedRunId=f.run.runId}x.set(f.run.chatId,f.run),fe(f.run.chatId,c)}else if(re(f.run.runId),re(de?.runId),x.delete(f.run.chatId),fe(f.run.chatId,c),f.run.actionId!=="guided_impersonate"||f.aborted||f.error)A.delete(f.run.chatId)}else if(D){if(re(K?.runId),re(T.get(D)?.observedRunId),x.delete(D),fe(D,c),K!==void 0&&K.actionId!=="guided_impersonate"||f.aborted||f.error)A.delete(D)}else if(!Y){if(U){for(let ne of x.values())re(ne.runId);for(let ne of T.values())re(ne.observedRunId)}if(x.clear(),h=c,U)A.clear()}if(J(),qe(),l)l={...l,activeRun:M};let q=le(b),Q=P!==q||b!==null&&(D===b||f.run?.chatId===b)||!D&&!f.run&&!Y;if(Q)Ue.sync(q),R.setSceneActiveRun(q);if(dt.handleStatusEvent(f,b),Q)ue();if(f.error)Z(f.error,"error",7000);return}case"gg:scene-updated":{if(Array.isArray(f.armedScenes)){B.clear();for(let D of f.armedScenes)if(We(D))B.set(D.chatId,D)}let b=typeof f.chatId==="string"&&f.chatId.length>0?f.chatId:We(f.armedScene)?f.armedScene.chatId:null;if(b){if(We(f.armedScene))B.set(b,f.armedScene);else if(f.armedScene===null||!Array.isArray(f.armedScenes))B.delete(b)}let P=F().chatId;if(R.setArmedScene(Ee(P),P),ue(),f.reason==="dropped"&&b&&b===P&&y&&R.isTabConnected()&&R.isShowingGuidedScene())Me();return}case"gg:impersonate-chunk":{if(typeof f.text==="string"){let b=f.chatId,D=(typeof b==="string"?b:null)??(x.size===1?Array.from(x.values())[0].chatId:M?.chatId??null),U=F().chatId;if(D!==null&&D!==U){if(f.done&&!f.aborted&&f.text.length>0)Lt(D,f.text);return}let Y=Le();if(!De(Y)||!U||Y.chatId!==U){if(f.done&&!f.aborted&&f.text.length>0&&D){if(Lt(D,f.text),D===U)Dt(U)}return}if(Xe(f.text,Y)){if(A.delete(U),f.done)Ye(Y)}else if(f.done&&!f.aborted&&f.text.length>0)Lt(U,f.text)}return}case"gg:recovery-updated":{if(l&&Array.isArray(f.recovery)){if(l={...l,recovery:f.recovery},ue(),y)R.updateRecovery(l.recovery,l.settings)}return}case"gg:changed":{se({onlyIfChanged:!0});return}case"gg:generation_metrics":{if(typeof f.chatId==="string"&&typeof f.messageId==="string"&&typeof f.swipeId==="number")Ve.handleMetricsEvent(f);return}}})),i.push(t.events.on("CHAT_SWITCHED",(a)=>{xt(an(a)??F().chatId)})),i.push(t.events.on("CHAT_CHANGED",(a)=>{xt(an(a)??F().chatId)})),i.push(t.events.on("CHAT_DELETED",(a)=>{if(r)return;let g=Yi(a);if(!g)return;if(c+=1,fe(g,c),x.delete(g),B.delete(g),A.delete(g),O===g)Pe();p.delete(g),J(),qe();let f=F().chatId,b=le(f);Ue.sync(b),R.setSceneActiveRun(b),R.setArmedScene(Ee(f),f),dt.onChatDeleted(g),Ve.onChatDeleted(g),ue()}));let fn=()=>{if(!r&&y&&R.isTabConnected()&&R.isShowingGuidedScene())Me()};if(i.push(t.events.on("MESSAGE_SENT",()=>{fn()})),i.push(t.events.on("MESSAGE_SWIPED",(a)=>{if(!r)Ve.onMessageEvent(a)})),i.push(t.events.on("MESSAGE_EDITED",(a)=>{if(!r)Ve.onMessageEvent(a)})),i.push(t.events.on("MESSAGE_DELETED",(a)=>{if(!r)Ve.onMessageDeleted(a),fn()})),t.connections?.subscribe)i.push(t.connections.subscribe(()=>{if(!r&&y)if(R.isTabConnected()||!E)se({onlyIfChanged:!0,includeCatalogs:!0});else E=!1}));let vn=!1;try{if(t.state)i.push(t.state.subscribe("chat.active",()=>{if(F().chatId===he)return;xt()})),vn=!0}catch{}if(!vn){let a=F().chatId,g=setInterval(()=>{if(r)return;let f=F().chatId;if(f!==a)a=f,xt(f)},600);i.push(()=>clearInterval(g))}if(typeof document<"u"){let a=()=>{if(document.visibilityState==="visible")ke()};document.addEventListener("visibilitychange",a),i.push(()=>{document.removeEventListener("visibilitychange",a)})}let He=typeof window<"u"?window:typeof document<"u"?document.defaultView:null;if(He&&typeof He.addEventListener==="function"){let a=()=>{ke()};He.addEventListener("focus",a),He.addEventListener("pageshow",a),He.addEventListener("online",a),i.push(()=>{He.removeEventListener("focus",a),He.removeEventListener("pageshow",a),He.removeEventListener("online",a)})}return t.ready(),se(),()=>{try{R.flushPendingSaves()}catch{}if(r=!0,L(),j=null,oe=!1,ce=!1,Pe(),N)clearTimeout(N),N=void 0;for(let a of i)try{a()}catch{}i.length=0;for(let a of Ie.values())clearTimeout(a.timer),a.reject(Error("Guided Generations unloaded."));Ie.clear(),T.clear(),I.clear(),p.clear(),x.clear(),B.clear(),v.clear(),A.clear();try{Ve.destroy()}catch{}try{dt.destroy()}catch{}try{Ue.destroy()}catch{}try{gn.destroy()}catch{}try{R.destroy()}catch{}try{ee?.replaceChildren()}catch{}try{n()}catch{}}}export{kr as setup};

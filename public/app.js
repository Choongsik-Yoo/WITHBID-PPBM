const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `${error ? "error " : ""}show`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = ""; }, 3000);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "요청에 실패했습니다.");
  return value;
}

function showView(id) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === id));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
}

async function refresh() {
  try {
    const [status, notices] = await Promise.all([api("/api/status"), api("/api/notices")]);
    $("#connection").textContent = "로컬 연결됨";
    $("#dataRoot").textContent = status.dataRoot;
    $("#noticeCount").textContent = status.noticeCount;
    $("#priceCount").textContent = status.priceCount;
    $("#noticeList").innerHTML = notices.length ? notices.map((notice) => `
      <article class="notice-card"><time>${notice.deadline}</time><div><h3>${escapeHtml(notice.title)}</h3><p>${escapeHtml(notice.noticeNumber)} · ${escapeHtml(notice.organization || "기관 미입력")}</p></div><span class="tag">${escapeHtml(notice.status)}</span></article>`).join("") : '<div class="empty">등록된 공고가 없습니다.</div>';
    $("#opalNotice").innerHTML = notices.length
      ? notices.map((notice) => `<option value="${notice.id}">${escapeHtml(notice.noticeNumber)} · ${escapeHtml(notice.title)}</option>`).join("")
      : '<option value="">먼저 공고를 등록하세요</option>';
  } catch (error) {
    $("#connection").textContent = "연결 오류";
    toast(error.message, true);
  }
}

async function loadOpenAISettings() {
  try {
    const settings = await api("/api/settings/openai");
    $("#keyStatus").textContent = settings.configured ? `등록됨 (${settings.keyHint})` : "등록되지 않음";
    $("#openaiSettingsForm").elements.extractionModel.value = settings.extractionModel;
    $("#openaiSettingsForm").elements.analysisModel.value = settings.analysisModel;
  } catch (error) { toast(error.message, true); }
}

async function loadG2bSettings() {
  try { const settings=await api("/api/settings/g2b"); $("#g2bKeyStatus").textContent=settings.configured?`등록됨 (${settings.keyHint})`:"등록되지 않음"; }
  catch(error){ toast(error.message,true); }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }

let signedInUser = null;

function loadGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script=document.createElement("script");script.src="https://accounts.google.com/gsi/client";script.async=true;script.defer=true;
    script.onload=resolve;script.onerror=()=>reject(new Error("Google 로그인 서비스를 불러오지 못했습니다."));document.head.appendChild(script);
  });
}

async function handleGoogleCredential(result) {
  try {
    const response=await api("/api/auth/google",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({credential:result.credential})});
    activateApp(response.user); toast(`${response.user.name}님, 로그인되었습니다.`);
  } catch(error){toast(error.message,true);$("#authMessage").textContent=error.message;}
}

function activateApp(user) {
  signedInUser=user; document.body.classList.remove("auth-pending"); $("#authGate").hidden=true;
  $("#currentUser").textContent=`${user.name} · ${user.role==="admin"?"관리자":"사용자"}`;$("#logoutButton").hidden=false;
  const admin=user.role==="admin";document.querySelector('[data-view="settings"]').hidden=!admin;
  if(!admin&&$("#settings").classList.contains("active"))showView("dashboard");
  refresh();if(admin){loadOpenAISettings();loadG2bSettings();loadUsers();}
}

async function initializeAuth() {
  document.body.classList.add("auth-pending");
  try {
    const [config,session]=await Promise.all([api("/api/auth/config"),api("/api/auth/me")]);
    if(session.authenticated)return activateApp(session.user);
    $("#authGate").hidden=false;
    if(!config.configured){$("#authMessage").textContent="관리자가 Google OAuth 웹 클라이언트 ID를 최초 1회 등록해야 합니다.";$("#authBootstrapForm").hidden=false;return;}
    await loadGoogleIdentity();
    google.accounts.id.initialize({client_id:config.clientId,callback:handleGoogleCredential,auto_select:false,cancel_on_tap_outside:false});
    google.accounts.id.renderButton($("#googleSignIn"),{theme:"outline",size:"large",shape:"pill",text:"signin_with",locale:"ko",width:320});
  } catch(error){$("#authGate").hidden=false;$("#authMessage").textContent=error.message;toast(error.message,true);}
}

async function loadUsers(){try{const users=await api("/api/admin/users");$("#userList").innerHTML=users.map((user)=>`<div class="user-row"><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.email)}</span><span class="role">${user.role}</span><button class="danger" type="button" data-delete-user="${encodeURIComponent(user.email)}" ${user.email===signedInUser?.email?"disabled":""}>삭제</button></div>`).join("");}catch(error){toast(error.message,true);}}

const progressStages=["공고 조회","첨부 다운로드","한컴문서 변환","AI 문서 추출","단가표 조회","외부 가격 검색","참가 판단","결과 저장"];
function renderProgress(progress){
  const panel=$("#analysisProgress"); panel.hidden=false; panel.classList.toggle("failed",progress.status==="failed");
  const percent=Math.max(0,Math.min(100,Number(progress.percent)||0));
  $("#progressStage").textContent=progress.message||"분석 준비"; $("#progressPercent").textContent=`${percent}%`; $("#progressBar").style.width=`${percent}%`;
  panel.querySelector("[role=progressbar]").setAttribute("aria-valuenow",String(percent));
  const active=Math.max(0,progressStages.indexOf(progress.stage));
  $("#progressSteps").innerHTML=progressStages.map((stage,index)=>`<li class="${index<active||percent===100?"done":index===active?"active":""}">${stage}</li>`).join("");
}

$$('.tab').forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
$$('[data-go]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.go)));

$("#noticeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/notices", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(formObject(event.currentTarget)) });
    event.currentTarget.reset(); toast("공고 폴더를 만들었습니다."); showView("dashboard"); await refresh();
  } catch (error) { toast(error.message, true); }
});

$("#priceFile").addEventListener("change", (event) => { $("#fileName").textContent = event.target.files[0]?.name || "선택된 파일 없음"; });
$("#uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const file = $("#priceFile").files[0]; if (!file) return;
  try {
    const result = await api("/api/price-list", { method:"POST", headers:{ "X-Filename":encodeURIComponent(file.name), "Content-Type":"application/octet-stream" }, body:await file.arrayBuffer() });
    toast(`${result.count}개 단가를 가져왔습니다.`); await refresh();
  } catch (error) { toast(error.message, true); }
});

$("#searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/prices/search", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(formObject(event.currentTarget)) });
    if (result.resolution === "company_price_list") {
      $("#priceResults").innerHTML = `<div class="result-card"><h3>자사 단가표 검색 결과</h3>${result.companyMatches.slice(0, 5).map((item) => `<div class="result-row"><div><strong>${escapeHtml(item.model)}</strong><p>${escapeHtml(item.category)} · ${escapeHtml(item.specification)} · 재고 ${escapeHtml(item.stock || "미기재")}</p></div><span class="price">${item.unitPrice == null ? "가격 미기재" : `${item.unitPrice.toLocaleString()}원`}</span></div>`).join("")}</div>`;
    } else {
      $("#priceResults").innerHTML = `<div class="result-card"><h3>자사 단가표 미등록 — 외부 가격 확인</h3><p>컴퓨존을 먼저 확인하고, 찾지 못하면 가이드컴을 확인하세요. 실제 상품 가격과 상세 링크는 담당자 확인 후 저장됩니다.</p>${result.externalSearches.map((item, index) => `<div class="result-row"><div><strong>${index + 2}순위 · ${item.sourceName}</strong><p>${escapeHtml(item.query)}</p></div><a href="${item.searchUrl}" target="_blank" rel="noreferrer">검색 열기 ↗</a></div>`).join("")}</div>`;
    }
  } catch (error) { toast(error.message, true); }
});

$("#opalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/opal/bundle", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(formObject(event.currentTarget)) });
    $("#opalBundle").value = result.bundle;
    toast("Opal 입력문을 만들고 D드라이브에 저장했습니다.");
  } catch (error) { toast(error.message, true); }
});

$("#copyOpal").addEventListener("click", async () => {
  const value = $("#opalBundle").value;
  if (!value) return toast("먼저 Opal 입력문을 만들어 주세요.", true);
  try { await navigator.clipboard.writeText(value); toast("Opal 입력문을 복사했습니다."); }
  catch { $("#opalBundle").select(); document.execCommand("copy"); toast("Opal 입력문을 복사했습니다."); }
});

$("#opalResultForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const noticeId = $("#opalNotice").value;
  try {
    const result = await api("/api/opal/result", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ noticeId, result:$("#opalResult").value }) });
    $("#opalResult").value = "";
    toast("Opal 결과를 분석 폴더에 저장했습니다.");
    await refresh();
  } catch (error) { toast(error.message, true); }
});

$("#openaiSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await api("/api/settings/openai", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(formObject(form)) });
    form.elements.apiKey.value = "";
    $("#keyStatus").textContent = `등록됨 (${result.keyHint})`;
    toast("OpenAI API 설정을 저장했습니다.");
  } catch (error) { toast(error.message, true); }
});

$("#autoAnalyzeForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form=event.currentTarget; const status=$("#automationStatus"); const button=form.querySelector("button");
  const jobId=crypto.randomUUID(); let polling=true; renderProgress({percent:1,stage:"공고 조회",message:"자동 분석을 준비하고 있습니다.",status:"running"});
  status.textContent="진행 상황을 실시간으로 확인하고 있습니다. 창을 닫지 마세요."; button.disabled=true;
  const poll=async()=>{while(polling){try{const progress=await api(`/api/automation/progress?id=${encodeURIComponent(jobId)}`);renderProgress(progress);}catch{}await new Promise(resolve=>setTimeout(resolve,700));}}; const pollingTask=poll();
  try { const result=await api("/api/automation/analyze-link",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...formObject(form),jobId})}); renderProgress({percent:100,stage:"결과 저장",message:"분석과 파일 저장을 완료했습니다.",status:"completed"}); status.textContent=`${result.report.decision}: ${result.report.summary} — 저장 완료`; form.reset(); await refresh(); toast("자동 분석을 완료했습니다."); }
  catch(error){ renderProgress({percent:100,stage:"결과 저장",message:error.message,status:"failed"}); status.textContent=error.message; toast(error.message,true); } finally { polling=false; await pollingTask; button.disabled=false; }
});

$("#g2bSettingsForm").addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget;try{const result=await api("/api/settings/g2b",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(formObject(form))});form.elements.apiKey.value="";$("#g2bKeyStatus").textContent=`등록됨 (${result.keyHint})`;toast("나라장터 API 설정을 저장했습니다.");}catch(error){toast(error.message,true);}});

$("#authBootstrapForm").addEventListener("submit",async(event)=>{event.preventDefault();try{await api("/api/auth/bootstrap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(formObject(event.currentTarget))});location.reload();}catch(error){toast(error.message,true);}});
$("#logoutButton").addEventListener("click",async()=>{await api("/api/auth/logout",{method:"POST"});location.reload();});
$("#userForm").addEventListener("submit",async(event)=>{event.preventDefault();try{await api("/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(formObject(event.currentTarget))});event.currentTarget.reset();await loadUsers();toast("사용자를 추가했습니다.");}catch(error){toast(error.message,true);}});
$("#userList").addEventListener("click",async(event)=>{const button=event.target.closest("[data-delete-user]");if(!button)return;if(!confirm("이 사용자의 앱 접근 권한을 삭제할까요?"))return;try{await api(`/api/admin/users/${button.dataset.deleteUser}`,{method:"DELETE"});await loadUsers();toast("사용자 접근 권한을 삭제했습니다.");}catch(error){toast(error.message,true);}});

initializeAuth();

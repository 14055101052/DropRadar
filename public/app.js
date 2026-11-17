const $ = (s) => document.querySelector(s);
const searchInput = $("#searchInput"), searchNotice = $("#searchNotice"), form = $("#addForm"), list = $("#watchlistItems"), toast = $("#toast");
let toastTimer;
function notify(message){toast.textContent=message;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove("show"),2800)}
function showNotice(message){searchNotice.textContent=message;searchNotice.classList.remove("hidden")}
async function search(){
  const q=searchInput.value.trim(); if(q.length<2){showNotice("Type at least two characters to search.");return}
  $("#searchButton").disabled=true; $("#searchButton").textContent="Searching…";
  try{const r=await fetch(`/api/search?q=${encodeURIComponent(q)}`),data=await r.json();showNotice(data.message||data.error||"Search is temporarily unavailable.")}
  catch{showNotice("Could not reach DropRadar. Check your connection and try again.")}
  finally{$("#searchButton").disabled=false;$("#searchButton").innerHTML='Search <span>→</span>'}
}
$("#searchButton").addEventListener("click",search);
searchInput.addEventListener("keydown",e=>{if(e.key==="Enter")search()});
document.querySelectorAll("[data-query]").forEach(b=>b.addEventListener("click",()=>{searchInput.value=b.dataset.query;searchInput.focus()}));
$("#toggleAdd").addEventListener("click",()=>{form.classList.toggle("hidden");if(!form.classList.contains("hidden"))form.elements.title.focus()});
$("#cancelAdd").addEventListener("click",()=>form.classList.add("hidden"));
form.addEventListener("submit",async e=>{
  e.preventDefault();const fd=new FormData(form),payload={title:fd.get("title"),url:fd.get("url"),targetPrice:fd.get("targetPrice")};
  try{const r=await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),data=await r.json();if(!r.ok)throw new Error(data.error||data.message);form.reset();form.classList.add("hidden");notify(data.note);await loadWatchlist()}
  catch(err){notify(err.message||"Could not save this link.")}
});
async function loadWatchlist(){try{const r=await fetch("/api/watchlist");if(!r.ok)throw new Error();const data=await r.json();renderItems(data.items||[])}catch{list.innerHTML='<div class="empty-state"><strong>Could not load your watchlist</strong><p>Refresh the page or check your connection.</p></div>'}}
function renderItems(items){
  if(!items.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">♡</div><strong>Your watchlist starts here</strong><p>Save a product link and set a target price to keep your shortlist organised.</p></div>';return}
  list.innerHTML=items.map(item=>`<article class="watch-item"><div class="watch-main"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.merchant)} · ${escapeHtml(item.url)}</span></div><div class="watch-meta">${item.target_price?`<span class="target">Target ₹${Number(item.target_price).toLocaleString("en-IN")}</span>`:""}<span class="status">Saved · tracking not active</span><button class="remove-btn" data-remove="${item.id}" aria-label="Remove ${escapeHtml(item.title)}">×</button></div></article>`).join("");
  list.querySelectorAll("[data-remove]").forEach(b=>b.addEventListener("click",async()=>{const r=await fetch(`/api/watchlist/${b.dataset.remove}`,{method:"DELETE"});if(r.ok){notify("Removed from your watchlist.");loadWatchlist()}else notify("Could not remove this item.")}));
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$("#refreshButton").addEventListener("click",loadWatchlist);
loadWatchlist();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));

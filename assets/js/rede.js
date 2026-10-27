/* Mapa funcional da área de atuação — Leaflet + mapa base Esri (dados OpenStreetMap).
   Ponto de integração: quando houver API da rede credenciada, os prestadores
   podem ser plotados aqui como marcadores (L.marker) a partir da busca. */
(function () {
  "use strict";
  var el = document.getElementById("map");
  var T = window.mgT || function (pt) { return pt; };
  if (!el || !window.L) return;
  var cities = {
    "Extrema/MG": { c: [-22.8547, -46.3178], hq: "R. Alcebíades Wohlers, 02 · Ponte Alta" },
    "Bragança Paulista/SP": { c: [-22.9527, -46.5419] },
    "Cambuí/MG": { c: [-22.6122, -46.0575] },
    "Pouso Alegre/MG": { c: [-22.2300, -45.9364], hq: "Av. Porfírio Ribeiro de Andrade, 90" }
  };
  var map = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView([-22.62, -46.2], 9);
  // Esri Light Gray Canvas: visual claro, sem chave e sem exigir Referer (os tiles do OSM bloqueiam acesso via file:// e sites sem política de uso)
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 16,
    attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
  }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16 }).addTo(map);
  var line = [cities["Bragança Paulista/SP"].c, cities["Extrema/MG"].c, cities["Cambuí/MG"].c, cities["Pouso Alegre/MG"].c];
  L.polyline(line, { color: "#008C8C", weight: 2, dashArray: "4 8", opacity: .8 }).addTo(map);
  var markers = {};
  var citySelect = document.getElementById("r-cidade");
  var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-city]"));
  function select(name) {
    var m = markers[name]; if (!m) return;
    map.flyTo(m.getLatLng(), 11, { duration: .8 });
    m.openPopup();
    if (citySelect) citySelect.value = name;
    buttons.forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-city") === name); });
    if (window.mgTrack) window.mgTrack("mapa_cidade", { cidade: name });
  }
  Object.keys(cities).forEach(function (name) {
    var d = cities[name];
    var icon = L.divIcon({ className: "", html: '<span class="mg-pin' + (d.hq ? " hq" : "") + '"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
    var popup = '<strong style="font-family:Poppins">' + name + "</strong>" + (d.hq ? "<br><small>" + T("Sede MedicGLOBAL", "MedicGLOBAL headquarters") + " · " + d.hq + "</small>" : "") +
      '<br><a href="#buscar" data-search-city="' + name + '" style="color:#00626D">' + T("Buscar atendimento nesta cidade", "Find care in this city") + "</a>";
    markers[name] = L.marker(d.c, { icon: icon, title: name, keyboard: true }).addTo(map).bindPopup(popup);
    markers[name].on("click", function () { select(name); });
  });
  map.fitBounds(L.latLngBounds(line).pad(.25));
  buttons.forEach(function (b) { b.addEventListener("click", function () { select(b.getAttribute("data-city")); }); });
  el.addEventListener("click", function (e) {
    var a = e.target.closest("[data-search-city]");
    if (a && citySelect) { citySelect.value = a.getAttribute("data-search-city"); document.getElementById("r-q").focus(); }
  });
})();

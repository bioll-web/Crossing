const cacheName = self.location.pathname
const pages = [
{{ if eq .Site.Params.BookServiceWorker "precache" }}
  {{ range .Site.AllPages -}}
  "{{ .RelPermalink }}",
  {{ end -}}
  {{ range $permalink, $ok := site.Store.Get "book-sw-precache" -}}
  "{{ $permalink }}",
  {{ end -}}
{{ end }}
];

self.addEventListener("install", function (event) {
  self.skipWaiting();

  caches.open(cacheName).then((cache) => {
    return cache.addAll(pages);
  });
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  // stale-while-revalidate：有缓存立刻返回，后台同步更新缓存
  event.respondWith(
    caches.match(request).then(function(cached) {
      var networkFetch = fetch(request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(cacheName).then(function(cache) {
            cache.put(request, clone);
          });
        }
        return response;
      }).catch(function() {
        return cached;
      });
      return cached || networkFetch;
    })
  );
});

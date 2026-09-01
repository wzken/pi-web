(function () {
  try {
    var params = new URLSearchParams(location.search);
    var mode = localStorage.getItem("pi-web:color-mode");
    var scheme =
      params.get("safe-theme") === "1"
        ? "light"
        : mode === "light" || mode === "dark"
          ? mode
          : matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    var root = document.documentElement;
    root.dataset.colorMode = scheme;
    root.style.colorScheme = scheme;
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = scheme === "dark" ? "#0c1110" : "#f3f5f0";
    }
    var lang = localStorage.getItem("pi-web.language");
    if (lang === "zh-CN" || lang === "en-US") root.lang = lang;
    else {
      var languages = navigator.languages || [navigator.language];
      root.lang = languages.some(function (language) {
        return String(language).toLowerCase().indexOf("zh") === 0;
      })
        ? "zh-CN"
        : "en-US";
    }
  } catch {}
})();

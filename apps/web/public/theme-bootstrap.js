(() => {
  const root = document.documentElement;
  const safeMode = new URLSearchParams(location.search).get("safe-theme") === "1";
  let mode = "system";
  try {
    const stored = localStorage.getItem("pi-web:color-mode");
    if (stored === "light" || stored === "dark" || stored === "system") {
      mode = stored;
    }
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
  const resolved =
    safeMode || mode === "light"
      ? "light"
      : mode === "dark" ||
          window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  root.dataset.colorMode = resolved;
  root.style.colorScheme = resolved;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = resolved === "dark" ? "#0b0b0c" : "#f7f7f8";
  }
})();

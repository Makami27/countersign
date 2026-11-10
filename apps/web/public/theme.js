try {
  if (window.localStorage.getItem("countersign:theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0F1A3A");
  }
} catch {
  delete document.documentElement.dataset.theme;
}

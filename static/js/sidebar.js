function setupSidebarToggle() {
    const toggle = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");

    if (!toggle || !sidebar) return;

    toggle.addEventListener("click", () => {
        sidebar.classList.toggle("open");
    });
}

setupSidebarToggle();
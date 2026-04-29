function setupSidebarToggle() {
    const toggle = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");

    if (!toggle || !sidebar) return;

    const mobileSidebarQuery = window.matchMedia("(max-width: 850px)");

    function syncSidebarMode() {
        const isMobile = mobileSidebarQuery.matches;

        toggle.hidden = !isMobile;
        toggle.setAttribute("aria-hidden", String(!isMobile));

        if (!isMobile) {
            sidebar.classList.remove("open");
        }
    }

    toggle.addEventListener("click", () => {
        sidebar.classList.toggle("open");
    });

    mobileSidebarQuery.addEventListener("change", syncSidebarMode);
    syncSidebarMode();
}

setupSidebarToggle();

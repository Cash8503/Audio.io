let uiToastContainer = null;

function uiGetToastContainer() {
    if (uiToastContainer) return uiToastContainer;

    uiToastContainer = document.createElement("div");
    uiToastContainer.className = "undo-toast-container";
    uiToastContainer.setAttribute("aria-live", "polite");
    document.body.appendChild(uiToastContainer);

    return uiToastContainer;
}

function uiRemoveToast(toast) {
    toast.classList.add("undo-toast-leaving");

    setTimeout(() => {
        toast.remove();
    }, 180);
}

function uiAddToast(toast, options = {}) {
    const maxToasts = options.maxToasts ?? 3;
    const container = uiGetToastContainer();
    const visibleToasts = Array.from(container.children).filter(child =>
        !child.classList.contains("undo-toast-leaving")
    );

    while (visibleToasts.length >= maxToasts) {
        const oldestToast = visibleToasts.shift();
        oldestToast.remove();
    }

    container.appendChild(toast);
    return toast;
}

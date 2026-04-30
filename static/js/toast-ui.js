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

function uiShowToast(message, options = {}) {
    const toast = document.createElement("div");
    toast.className = "undo-toast";

    if (options.status) {
        toast.classList.add(options.status);
    }

    const text = document.createElement("p");
    text.className = "undo-toast-message";
    text.textContent = message;

    const closeButton = document.createElement("button");
    closeButton.className = "undo-toast-close";
    closeButton.type = "button";
    closeButton.textContent = "x";
    closeButton.setAttribute("aria-label", "Dismiss message");

    toast.append(text, closeButton);
    uiAddToast(toast, { maxToasts: options.maxToasts ?? 3 });

    const timeoutId = setTimeout(
        () => uiRemoveToast(toast),
        options.timeoutMs ?? 6000
    );

    closeButton.addEventListener("click", () => {
        clearTimeout(timeoutId);
        uiRemoveToast(toast);
    });

    return toast;
}

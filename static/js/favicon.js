async function updateFaviconFromCSSVar() {
    const settings = await fetchSettings();
    const color = settings?.accent_color?.value || "#8b5cf6";

    console.log("favicon color:", color);

    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
            <path fill="${color}" d="M400-120q-50 0-85-35t-35-85q0-50 35-85t85-35q23 0 43.5 8t36.5 22v-510h280v160H560v440q0 50-35 85t-125 35Z"/>
        </svg>
    `;
    const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>music</title><path fill="${color}" d="M21,3V15.5A3.5,3.5 0 0,1 17.5,19A3.5,3.5 0 0,1 14,15.5A3.5,3.5 0 0,1 17.5,12C18.04,12 18.55,12.12 19,12.34V6.47L9,8.6V17.5A3.5,3.5 0 0,1 5.5,21A3.5,3.5 0 0,1 2,17.5A3.5,3.5 0 0,1 5.5,14C6.04,14 6.55,14.12 7,14.34V6L21,3Z" /></svg>`;

    const href = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg2);

    let link = document.querySelector("link[rel='icon']");

    if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
    }

    link.type = "image/svg+xml";
    link.href = href;
}

updateFaviconFromCSSVar().catch(error => {
    console.error("Failed to update favicon:", error);
});
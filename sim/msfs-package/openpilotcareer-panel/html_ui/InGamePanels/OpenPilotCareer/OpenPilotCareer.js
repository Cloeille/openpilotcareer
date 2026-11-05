/* Sim glue only: mounts the panel and polls; pauses while the sim reports the panel inactive.
 * Polling starts at mount so the panel works even if the activity events never fire.
 * Structure follows the community toolbar-window template; TemplateElement, checkAutoload and the
 * panelActive/panelInactive events come from the sim's own scripts (see OpenPilotCareer.html). */
class IngamePanelOpenPilotCareer extends TemplateElement {
    constructor() {
        super(...arguments);
        this.panel = null;
    }
    connectedCallback() {
        super.connectedCallback();
        var self = this;
        this.panel = OPCPanel.mount(document.getElementById("opc-root"));
        this.panel.start();
        var ui = this.querySelector("ingame-ui");
        if (ui) {
            ui.addEventListener("panelActive", function () { self.panel.start(); });
            ui.addEventListener("panelInactive", function () { self.panel.stop(); });
        }
    }
    disconnectedCallback() {
        if (this.panel) this.panel.stop();
        super.disconnectedCallback();
    }
}
window.customElements.define("ingamepanel-opc", IngamePanelOpenPilotCareer);
checkAutoload();

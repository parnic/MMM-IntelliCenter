/* global Module Log document */

Module.register("MMM-IntelliCenter", {
  poolData: null,

  defaults: {
    showPoolTemp: true,
    showSpaTemp: true,
    showPH: true,
    showOrp: true,
    showSaltLevel: true,
    showSaturation: true,
    showFreezeMode: true,
    showControls: false,
    controls: [],
    colored: true,
    coldTemp: 84,
    hotTemp: 90,
    columns: 3,
    contentClass: "light",
    showPHTankLevel: true,
    pHTankLevelMax: 7,
    serverAddress: "",
    serverPort: 6680,
    multicastInterface: "",
  },

  start() {
    if (
      this.config.showControls &&
      (!this.config.controls || this.config.controls.length === 0)
    ) {
      Log.warn(
        "Controls are enabled, but no controls are configured. See README for info on setting up controls.",
      );
      this.config.showControls = false;
    }

    this.sendSocketNotification("INTELLICENTER_CONFIG", this.config);
  },

  getStyles() {
    return ["intellicenter.css"];
  },

  getDom() {
    if (!this.poolData) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = "Loading IntelliCenter...";
      wrapper.className += "dimmed light small text-center";

      return wrapper;
    }
    const outermost = document.createElement("div");
    outermost.classList.add("container");

    const reconnectDiv = document.createElement("div");
    reconnectDiv.classList.add("overlay", "reconnecting", "d-none");

    const reconnectLabel = document.createElement("div");
    reconnectLabel.classList.add("margin-auto", "bg-blur");
    reconnectLabel.innerHTML = "Reconnecting...";
    reconnectDiv.appendChild(reconnectLabel);

    const table = document.createElement("table");
    table.classList.add("base-content", "small");
    if (this.config.colored) {
      table.classList.add("colored");
    }

    outermost.appendChild(reconnectDiv);
    outermost.appendChild(table);

    const contents = [];

    if (this.config.showPoolTemp) {
      let poolTemp = this.getPoolTempDom();
      contents.push(poolTemp);
    }
    if (this.config.showSpaTemp) {
      let spaTemp = this.getSpaTempDom();
      contents.push(spaTemp);
    }
    if (this.config.showPH) {
      let ph = this.getPHDom();
      contents.push(ph);
    }
    if (this.config.showOrp) {
      contents.push(this.getOrpDom());
    }
    if (this.config.showSaltLevel) {
      contents.push(this.getSaltDom());
    }
    if (this.config.showSaturation) {
      contents.push(this.getSaturationDom());
    }
    if (this.config.showControls) {
      let controls = this.getControlsDom();
      for (const control of controls) {
        contents.push(control);
      }
    }

    let headerRow = null;
    let contentRow = null;

    if (this.config.showFreezeMode && this.poolData.freezeMode) {
      const row = document.createElement("tr");
      table.appendChild(row);
      row.className = "cold-temp";
      const cell = document.createElement("th");
      row.appendChild(cell);
      cell.colSpan = this.config.columns;
      cell.innerHTML = "<center>FREEZE MODE</center>";
    }

    let cols = -1;
    for (const item of contents) {
      cols++;
      if (cols % this.config.columns === 0) {
        headerRow = document.createElement("tr");
        contentRow = document.createElement("tr");
        table.appendChild(headerRow);
        table.appendChild(contentRow);
      }

      if (item.header) {
        const headerCell = document.createElement("th");
        headerCell.innerHTML = item.header;
        headerRow.appendChild(headerCell);
      }

      const contentCell = document.createElement("td");
      if (item.dom) {
        contentCell.appendChild(item.dom);
      } else {
        contentCell.innerHTML = item.data;
      }
      contentCell.className = item.class;
      contentRow.appendChild(contentCell);
    }

    return outermost;
  },

  getPoolTempDom() {
    let className = "";
    if (this.poolData.poolTemp <= this.config.coldTemp) {
      className += " cold-temp";
    } else if (this.poolData.poolTemp >= this.config.hotTemp) {
      className += " hot-temp";
    }

    return {
      header: "Pool temp",
      data: `${this.poolData.poolTemp}&deg;${!this.poolData.poolStatus ? " (last)" : ""}`,
      class: this.config.contentClass + className,
    };
  },

  getSpaTempDom() {
    let className = "";
    if (this.poolData.spaTemp <= this.config.coldTemp) {
      className = " cold-temp";
    } else if (this.poolData.spaTemp >= this.config.hotTemp) {
      className = " hot-temp";
    }

    return {
      header: "Spa temp",
      data: `${this.poolData.spaTemp}&deg;${!this.poolData.spaStatus ? " (last)" : ""}`,
      class: this.config.contentClass + className,
    };
  },

  getPHDom() {
    let dataStr = this.poolData.lastPHVal;
    if (this.config.showPHTankLevel) {
      const percent = Math.round(
        ((this.poolData.phTank - 1) / this.config.pHTankLevelMax) * 100,
      );
      let cls = "";
      if (this.config.colored) {
        if (percent <= 17) {
          cls = "progress-bar-danger";
        } else if (percent <= 33) {
          cls = "progress-bar-warning";
        } else {
          cls = "progress-bar-success";
        }
      }
      const progBarDiv = `<div class="progress vertical">
                        <div class="progress-bar ${cls}" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" style="width: ${percent}%;">
                        </div>
                    </div>`;

      dataStr = `${dataStr} ${progBarDiv}`;
    }

    return {
      header: "pH",
      data: dataStr,
      class: this.config.contentClass,
    };
  },

  getOrpDom() {
    return {
      header: "ORP",
      data: this.poolData.lastOrpVal.toString(),
      class: this.config.contentClass,
    };
  },

  getSaltDom() {
    return {
      header: "Salt PPM",
      data: this.poolData.saltPPM.toString(),
      class: this.config.contentClass,
    };
  },

  getSaturationDom() {
    return {
      header: "Saturation",
      data: this.poolData.saturation.toString(),
      class: this.config.contentClass,
    };
  },

  getControlsDom() {
    let controls = [];

    for (const controlObj of this.config.controls) {
      if (controlObj.type === "circuit") {
        let circuit = this.getCircuitDom(controlObj);
        controls.push(circuit);
      } else if (controlObj.type === "heatpoint") {
        let circuit = this.getHeatpointDom(controlObj);
        if (circuit) {
          controls.push(circuit);
        }
      } else if (controlObj.type === "heatmode") {
        let circuit = this.getHeatmodeDom(controlObj);
        if (circuit) {
          controls.push(circuit);
        }
      } else {
        Log.warn("circuit with unknown type, unable to display:");
        Log.warn(controlObj);
      }
    }

    return controls;
  },

  getCircuitDom(controlObj) {
    let { name } = controlObj;
    let on = false;
    if (this.poolData.circuits[controlObj.id]) {
      name ??= this.poolData.circuits[controlObj.id].name;
      on = this.poolData.circuits[controlObj.id].status;
    }

    let cls = "";
    if (this.config.colored) {
      cls = on ? "control-on" : "control-off";
    }

    const button = document.createElement("button");
    button.id = `sl-control-${controlObj.id}`;
    button.classList.add("control", cls);
    button.onclick = (e) => {
      this.setCircuit(e.currentTarget);
    };
    button.dataset.circuit = controlObj.id;
    button.dataset.state = on ? 1 : 0;

    const content = document.createElement("div");
    content.classList.add("content");
    content.innerText = name;

    button.appendChild(content);

    return {
      dom: button,
      class: this.config.contentClass,
    };
  },

  getHeatpointDom(controlObj) {
    // todo: if "body" isn't defined in the user's config correctly, this will error out
    const body = controlObj.body.toLowerCase();
    if (body !== "pool" && body !== "spa") {
      Log.warn("Invalid body specified for heatpoint. Valid bodies: pool, spa");
      return;
    }

    const temperature =
      body === "pool"
        ? this.poolData.poolSetPoint.toString()
        : this.poolData.spaSetPoint.toString();

    const div = document.createElement("div");
    div.classList.add("temperature-container");

    const buttonUp = document.createElement("button");
    buttonUp.id = `sl-temp-up-${controlObj.body}`;
    buttonUp.classList.add("control-off", "temperature");
    buttonUp.onclick = (e) => {
      this.setHeatpoint(e.currentTarget, 1);
    };
    buttonUp.dataset.body = controlObj.body;
    buttonUp.dataset.temperature = temperature;

    const contentUp = document.createElement("div");
    contentUp.classList.add("content");
    contentUp.innerText = "+";

    buttonUp.appendChild(contentUp);
    div.appendChild(buttonUp);

    const label = document.createElement("div");
    label.classList.add("temperature-label");
    label.innerHTML = `${controlObj.name}: ${temperature}&deg;`;
    div.appendChild(label);

    const buttonDown = document.createElement("button");
    buttonDown.id = `sl-temp-down-${controlObj.body}`;
    buttonDown.classList.add("control-off", "temperature");
    buttonDown.onclick = (e) => {
      this.setHeatpoint(e.currentTarget, -1);
    };
    buttonDown.dataset.body = controlObj.body;
    buttonDown.dataset.temperature = temperature;

    const contentDown = document.createElement("div");
    contentDown.classList.add("content");
    contentDown.innerText = "-";

    buttonDown.appendChild(contentDown);
    div.appendChild(buttonDown);

    return {
      dom: div,
      class: this.config.contentClass,
    };
  },

  getHeatmodeDom(controlObj) {
    // todo: if "body" isn't defined in the user's config correctly, this will error out
    const body = controlObj.body.toLowerCase();
    if (body !== "pool" && body !== "spa") {
      Log.warn("Invalid body specified for heatmode. Valid bodies: pool, spa");
      return;
    }

    const on =
      body === "pool"
        ? this.poolData.poolHeaterStatus
        : this.poolData.spaHeaterStatus;

    let cls = "";
    if (this.config.colored) {
      cls = on ? "control-on" : "control-off";
    }

    const button = document.createElement("button");
    button.id = `sl-heat-${controlObj.body}`;
    button.classList.add("control", cls);
    button.onclick = (e) => {
      this.setHeatmode(e.currentTarget);
    };
    button.dataset.body = controlObj.body;
    button.dataset.state = on ? 1 : 0;

    const content = document.createElement("div");
    content.classList.add("content");
    content.innerText = controlObj.name;

    button.appendChild(content);

    return {
      dom: button,
      class: this.config.contentClass,
    };
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "INTELLICENTER_RESULT") {
      this.poolData = payload;
      this.updateDom();
      this.showReconnectOverlay(false);
    } else if (notification === "INTELLICENTER_RECONNECTING") {
      this.showReconnectOverlay(true);
    }
  },

  showReconnectOverlay(show) {
    const element = document.querySelector(".MMM-IntelliCenter .reconnecting");
    if (!element || !element.classList) {
      return;
    }

    if (show) {
      element.classList.remove("d-none");
    } else {
      element.classList.add("d-none");
    }
  },

  setCircuit(e) {
    const circuitId = e.dataset.circuit;
    const on = e.dataset.state !== "0";
    this.sendSocketNotification("INTELLICENTER_CIRCUIT", {
      id: circuitId,
      state: on ? 0 : 1,
    });
    e.classList.remove("control-on", "control-off");
  },

  setHeatmode(e) {
    const bodyId = e.dataset.body;
    const on = e.dataset.state !== "0";
    this.sendSocketNotification("INTELLICENTER_HEATSTATE", {
      body: bodyId,
      state: on ? 0 : 1,
    });
    e.classList.remove("control-on", "control-off");
  },

  setHeatpoint(e, tempChange) {
    const bodyId = e.dataset.body;
    const temp = parseInt(e.dataset.temperature) + tempChange;
    this.sendSocketNotification("INTELLICENTER_HEATPOINT", {
      body: bodyId,
      temperature: temp,
    });
    e.classList.remove("control-on", "control-off");
  },
});

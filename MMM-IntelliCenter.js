/* global Module Log document */

let poolData;

Module.register("MMM-IntelliCenter", {
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
    serverPort: 0,
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
    if (!poolData) {
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
      let className = "";
      if (poolData.poolTemp <= this.config.coldTemp) {
        className += " cold-temp";
      } else if (poolData.poolTemp >= this.config.hotTemp) {
        className += " hot-temp";
      }

      contents.push({
        header: "Pool temp",
        data: `${poolData.poolTemp}&deg;${!poolData.poolStatus ? " (last)" : ""}`,
        class: this.config.contentClass + className,
      });
    }
    if (this.config.showSpaTemp) {
      let className = "";
      if (poolData.spaTemp <= this.config.coldTemp) {
        className = " cold-temp";
      } else if (poolData.spaTemp >= this.config.hotTemp) {
        className = " hot-temp";
      }

      contents.push({
        header: "Spa temp",
        data: `${poolData.spaTemp}&deg;${!poolData.spaStatus ? " (last)" : ""}`,
        class: this.config.contentClass + className,
      });
    }
    if (this.config.showPH) {
      let dataStr = poolData.lastPHVal;
      if (this.config.showPHTankLevel) {
        const percent = Math.round(
          ((poolData.phTank - 1) / this.config.pHTankLevelMax) * 100,
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

      contents.push({
        header: "pH",
        data: dataStr,
        class: this.config.contentClass,
      });
    }
    if (this.config.showOrp) {
      contents.push({
        header: "ORP",
        data: poolData.lastOrpVal.toString(),
        class: this.config.contentClass,
      });
    }
    if (this.config.showSaltLevel) {
      contents.push({
        header: "Salt PPM",
        data: poolData.saltPPM.toString(),
        class: this.config.contentClass,
      });
    }
    if (this.config.showSaturation) {
      contents.push({
        header: "Saturation",
        data: poolData.saturation.toString(),
        class: this.config.contentClass,
      });
    }
    if (this.config.showControls) {
      for (const control in this.config.controls) {
        const controlObj = this.config.controls[control];

        if (controlObj.type === "circuit") {
          let { name } = controlObj;
          let on = false;
          if (poolData.circuits[controlObj.id]) {
            name ??= poolData.circuits[controlObj.id].name;
            on = poolData.circuits[controlObj.id].status;
          }

          let cls = "";
          if (this.config.colored) {
            cls = on ? "control-on" : "control-off";
          }

          contents.push({
            data: `<button id="sl-control-${controlObj.id}" class="control ${cls}" onclick="setCircuit(this)" data-circuit="${
              controlObj.id
            }" data-state="${on ? "1" : "0"}"><div class="content">${
              name
            }</div></button>`,
            class: this.config.contentClass,
          });
        } else if (controlObj.type === "heatpoint") {
          // todo: if "body" isn't defined in the user's config correctly, this will error out
          const body = controlObj.body.toLowerCase();
          if (body !== "pool" && body !== "spa") {
            Log.warn(
              "Invalid body specified for heatpoint. Valid bodies: pool, spa",
            );
            continue;
          }

          const temperature =
            body === "pool"
              ? poolData.poolSetPoint.toString()
              : poolData.spaSetPoint.toString();

          let dataHtml = '<div class="temperature-container">';
          dataHtml += `<button id="sl-temp-up-${controlObj.body}" class="temperature control-off" onclick="setHeatpoint(this, 1)" data-body="${controlObj.body}" data-temperature="${temperature}"><div class="content">+</div></button>`;
          dataHtml += `<div class="temperature-label">${controlObj.name}: ${temperature}&deg;</div>`;
          dataHtml += `<button id="sl-temp-down-${controlObj.body}" class="temperature control-off" onclick="setHeatpoint(this, -1)" data-body="${controlObj.body}" data-temperature="${temperature}"><div class="content">-</div></button>`;

          contents.push({
            data: dataHtml,
            class: this.config.contentClass,
          });
        } else if (controlObj.type === "heatmode") {
          // todo: if "body" isn't defined in the user's config correctly, this will error out
          const body = controlObj.body.toLowerCase();
          if (body !== "pool" && body !== "spa") {
            Log.warn(
              "Invalid body specified for heatmode. Valid bodies: pool, spa",
            );
            continue;
          }

          const on =
            body === "pool"
              ? poolData.poolHeaterStatus
              : poolData.spaHeaterStatus;
          const mode =
            typeof controlObj.heatMode === "number" ? controlObj.heatMode : 3;

          let cls = "";
          if (this.config.colored) {
            cls = on ? "control-on" : "control-off";
          }

          contents.push({
            data: `<button id="sl-heat-${controlObj.body}" class="control ${cls}" onclick="setHeatmode(this)" data-body="${
              controlObj.body
            }" data-state="${on ? "1" : "0"}" data-mode="${mode.toString()}"><div class="content">${
              controlObj.name
            }</div></button>`,
            class: this.config.contentClass,
          });
        } else {
          Log.warn("circuit with unknown type, unable to display:");
          Log.warn(controlObj);
        }
      }
    }

    let headerRow = null;
    let contentRow = null;

    if (this.config.showFreezeMode && poolData.freezeMode) {
      const row = document.createElement("tr");
      table.appendChild(row);
      row.className = "cold-temp";
      const cell = document.createElement("th");
      row.appendChild(cell);
      cell.colSpan = this.config.columns;
      cell.innerHTML = "<center>FREEZE MODE</center>";
    }

    let cols = -1;
    for (const item in contents) {
      cols++;
      if (cols % this.config.columns === 0) {
        headerRow = document.createElement("tr");
        contentRow = document.createElement("tr");
        table.appendChild(headerRow);
        table.appendChild(contentRow);
      }

      if (contents[item].header) {
        const headerCell = document.createElement("th");
        headerCell.innerHTML = contents[item].header;
        headerRow.appendChild(headerCell);
      }

      const contentCell = document.createElement("td");
      contentCell.innerHTML = contents[item].data;
      contentCell.className = contents[item].class;
      contentRow.appendChild(contentCell);
    }

    return outermost;
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "INTELLICENTER_RESULT") {
      poolData = payload;
      this.updateDom();
      this.showReconnectOverlay(false);
    } else if (
      notification === "INTELLICENTER_CIRCUIT_DONE" ||
      notification === "INTELLICENTER_HEATSTATE_DONE" ||
      notification === "INTELLICENTER_HEATPOINT_DONE"
    ) {
      poolData = payload;
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
});

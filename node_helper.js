var NodeHelper = require("node_helper");

const { FindUnits, Unit } = require("node-intellicenter");
const messages = require("node-intellicenter/messages");
const Log = require("logger");
const path = require("path");
const fs = require("fs");
const filename = "/lastData.json";

var configFilename = path.resolve(__dirname + filename);

const reconnectDelayMs = 10 * 1000;
const unitFinderTimeoutMs = 5 * 1000;
let foundUnit;
const poolData = {
  poolTemp: 0,
  spaTemp: 0,
  poolSetPoint: 0,
  spaSetPoint: 0,
  poolHeaterStatus: false,
  spaHeaterStatus: false,
  poolStatus: false,
  spaStatus: false,
  phVal: 0,
  lastPHVal: 0,
  phTank: 0,
  orp: 0,
  lastOrpVal: 0,
  saltPPM: 0,
  saturation: 0,
  freezeMode: false,
  circuits: {},
};
let poolObjnam = "B1101";
let spaObjnam = "B1202";
let refreshTimer;
let unitFinderRetry;
let unitReconnectTimer;
let intellichemObjnam = "";
let chlorinatorObjnam = "";
let freezeObjnam = "";
let initialConnectDone = false;

module.exports = NodeHelper.create({
  start() {
    Log.info("##### Starting node helper for: " + this.name);

    try {
      const data = fs.readFileSync(configFilename);
      if (data && data.length > 0) {
        const parsed = JSON.parse(data);
        poolData.lastPHVal = parsed.lastPH ?? 0;
        poolData.lastOrpVal = parsed.lastOrp ?? 0;
      }
    } catch {
      // no existing config
    }
  },

  saveLast() {
    const obj = {
      lastPH: poolData.lastPHVal,
      lastOrp: poolData.lastOrpVal,
    };

    const json = JSON.stringify(obj);
    fs.writeFileSync(configFilename, json, "utf8");
  },

  setCircuit(circuitState) {
    if (!foundUnit) {
      return;
    }

    Log.info(
      `[MMM-IntelliCenter] setting circuit ${circuitState.id} to ${!!circuitState.state}`,
    );
    foundUnit.send(
      messages.SetObjectStatus(circuitState.id, !!circuitState.state),
    );
  },

  setHeatpoint(heatpoint) {
    if (!foundUnit) {
      return;
    }

    let heatObjnam = "";
    if (heatpoint.body === "spa") {
      heatObjnam = spaObjnam;
    } else if (heatpoint.body === "pool") {
      heatObjnam = poolObjnam;
    }

    if (!heatObjnam) {
      Log.error(
        `[MMM-IntelliCenter] unable to determine objnam from given heatpoint body ${heatpoint.body} - expected "spa" or "pool"`,
      );
      return;
    }

    Log.info(
      `[MMM-IntelliCenter] setting heatpoint for body ${heatObjnam} to ${heatpoint.temperature} deg`,
    );
    foundUnit.send(messages.SetSetpoint(heatObjnam, heatpoint.temperature));
  },

  setHeatstate(heatstate) {
    if (!foundUnit) {
      return;
    }
    let heatObjnam = "";
    if (heatstate.body === "spa") {
      heatObjnam = spaObjnam;
    } else if (heatstate.body === "pool") {
      heatObjnam = poolObjnam;
    }

    if (!heatObjnam) {
      Log.error(
        `[MMM-IntelliCenter] unable to determine objnam from given heatstate body ${heatstate.body} - expected "spa" or "pool"`,
      );
      return;
    }

    Log.info(
      `[MMM-IntelliCenter] setting heat state for body ${heatObjnam} to ${!!heatstate.state}`,
    );
    foundUnit.send(messages.SetHeatMode(heatObjnam, !!heatstate.state));
  },

  setLightcmd(lightCmd) {
    if (!foundUnit) {
      return;
    }

    Log.info(`[MMM-IntelliCenter] sending light command ${lightCmd}`);
    // NYI in node-intellicenter
    // foundUnit.send(messages.SendLightCommand(lightCmd));
  },

  notifyReconnecting() {
    this.sendSocketNotification("INTELLICENTER_RECONNECTING");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "INTELLICENTER_CONFIG") {
      if (!this.config) {
        this.config = payload;
        this.connect(
          (status) => {
            this.sendSocketNotification("INTELLICENTER_RESULT", status);
          },
          () => {
            this.notifyReconnecting();
          },
        );
      } else if (poolData) {
        this.sendSocketNotification("INTELLICENTER_RESULT", poolData);
      }
      // If we don't have a status yet, assume the initial connection is still in progress and this socket notification will be delivered when setup is done
    }
    if (notification === "INTELLICENTER_CIRCUIT") {
      this.setCircuit(payload);
    }
    if (notification === "INTELLICENTER_HEATPOINT") {
      this.setHeatpoint(payload);
    }
    if (notification === "INTELLICENTER_HEATSTATE") {
      this.setHeatstate(payload);
    }
    if (notification === "INTELLICENTER_LIGHTCMD") {
      this.setLightcmd(payload);
    }
  },

  resetFoundUnit() {
    foundUnit = null;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (unitFinderRetry) {
      clearInterval(unitFinderRetry);
      unitFinderRetry = null;
    }
    if (unitReconnectTimer) {
      clearTimeout(unitReconnectTimer);
      unitReconnectTimer = null;
    }
  },

  setupUnit(cb, reconnectCb) {
    Log.info("[MMM-IntelliCenter] initial connection to unit...");
    initialConnectDone = false;

    const reset = () => {
      reconnectCb();
      this.resetFoundUnit();
      unitReconnectTimer = setTimeout(() => {
        this.connect(cb, reconnectCb);
      }, reconnectDelayMs);
    };

    foundUnit
      .on("error", (e) => {
        Log.error("[MMM-IntelliCenter] error in unit connection.");
        Log.error(e);
      })
      .on("close", () => {
        Log.error(
          `[MMM-IntelliCenter] unit connection closed unexpectedly. restarting the connection process in ${reconnectDelayMs / 1000} seconds`,
        );

        reset();
      })
      .on("timeout", () => {
        Log.error("[MMM-IntelliCenter] unit connection timed out.");
      })
      .on("notify", (msg) => {
        for (const obj of msg.objectList) {
          if (obj.objnam === intellichemObjnam) {
            Log.info("[MMM-IntelliCenter] received chemical update");

            if (obj.params.ORPVAL) {
              poolData.orp = parseInt(obj.params.ORPVAL);
            }
            if (obj.params.PHVAL) {
              poolData.phVal = parseFloat(obj.params.PHVAL);
            }
            if (obj.params.PHTNK) {
              poolData.phTank = parseInt(obj.params.PHTNK);
            }
            if (obj.params.QUALTY) {
              poolData.saturation = parseFloat(obj.params.QUALTY);
            }

            if (poolData.phVal !== 0) {
              poolData.lastPHVal = poolData.phVal;
              this.saveLast();
            }
            if (poolData.orp !== 0) {
              poolData.lastOrpVal = poolData.orp;
              this.saveLast();
            }
          } else if (obj.objnam === poolObjnam) {
            Log.info("[MMM-IntelliCenter] received pool update");

            if (obj.params.LOTMP) {
              poolData.poolSetPoint = parseInt(obj.params.LOTMP);
            }
            // todo: is MODE the right check for this?
            if (obj.params.MODE) {
              poolData.poolHeaterStatus = obj.params.MODE === "11";
            }
            if (obj.params.STATUS) {
              poolData.poolStatus = obj.params.STATUS === "ON";
            }
            if (obj.params.LSTTMP) {
              poolData.poolTemp = parseInt(obj.params.LSTTMP);
            }
          } else if (obj.objnam === spaObjnam) {
            Log.info("[MMM-IntelliCenter] received spa update");

            if (obj.params.LOTMP) {
              poolData.spaSetPoint = parseInt(obj.params.LOTMP);
            }
            // todo: is MODE the right check for this?
            if (obj.params.MODE) {
              poolData.spaHeaterStatus = obj.params.MODE === "11";
            }
            if (obj.params.STATUS) {
              poolData.spaStatus = obj.params.STATUS === "ON";
            }
            if (obj.params.LSTTMP) {
              poolData.spaTemp = parseInt(obj.params.LSTTMP);
            }
          } else if (obj.objnam === chlorinatorObjnam) {
            Log.info("[MMM-IntelliCenter] received chlorinator update");

            if (obj.params.SALT) {
              poolData.saltPPM = parseInt(obj.params.SALT);
            }
          } else if (obj.objnam === freezeObjnam) {
            Log.info("[MMM-IntelliCenter] received freeze-protection update");

            if (obj.params.STATUS) {
              poolData.freezeMode = obj.params.STATUS === "ON";
            }
          } else if (Object.keys(poolData.circuits).includes(obj.objnam)) {
            Log.info(
              `[MMM-IntelliCenter] received update for circuit ${obj.objnam} (${poolData.circuits[obj.objnam].name})`,
            );

            if (obj.params.STATUS) {
              poolData.circuits[obj.objnam].status = obj.params.STATUS === "ON";
            }
          } else {
            Log.info(
              `[MMM-IntelliCenter] received update for untracked object: ${obj.objnam}`,
            );
          }
        }

        if (initialConnectDone) {
          cb(poolData);
        }
      })
      .once("connected", async () => {
        Log.info(
          "[MMM-IntelliCenter] logged into unit. getting system configuration...",
        );
        const sysinfo = await foundUnit.send(messages.GetSystemConfiguration());
        const bodyUpdates = [];
        for (const obj of sysinfo.answer) {
          if (obj.params.OBJTYP === "BODY" && obj.params.SUBTYP === "POOL") {
            const ichem = obj.params.OBJLIST?.find(
              (obj) => obj.params.SUBTYP === "ICHEM",
            );
            intellichemObjnam = ichem?.objnam;

            poolObjnam = obj.objnam;
            bodyUpdates.push(obj.objnam);
          } else if (
            obj.params.OBJTYP === "BODY" &&
            obj.params.SUBTYP === "SPA"
          ) {
            spaObjnam = obj.objnam;
            bodyUpdates.push(obj.objnam);
          }
        }

        Log.info("[MMM-IntelliCenter] getting chemical status...");
        const chemstatus = await foundUnit.send(messages.GetChemicalStatus());
        for (const obj of chemstatus.objectList) {
          if (obj.params.SUBTYP === "ICHLOR") {
            chlorinatorObjnam = obj.objnam;
          }
        }

        Log.info("[MMM-IntelliCenter] getting circuit information...");
        const circuits = await foundUnit.send(messages.GetCircuitStatus());
        const freezeCirc = circuits.objectList?.find(
          (obj) => obj.params?.SUBTYP === "FRZ",
        );
        if (freezeCirc) {
          freezeObjnam = freezeCirc.objnam;
          Log.info(
            `[MMM-IntelliCenter] registering for freeze-protection updates...`,
          );
          await foundUnit.send(
            messages.SubscribeToUpdates(freezeObjnam, "STATUS"),
          );
        }
        if (this.config.controls?.length > 0) {
          for (const circuit of circuits.objectList) {
            const wantedControl = this.config.controls.find(
              (c) => c.id === circuit.objnam,
            );
            if (!wantedControl) {
              continue;
            }

            poolData.circuits[circuit.objnam] = {
              status: false,
              name: circuit.params.SNAME,
            };
          }
        }

        for (const circuit of Object.keys(poolData.circuits)) {
          Log.info(`[MMM-IntelliCenter] registering for ${circuit} updates...`);
          await foundUnit.send(messages.SubscribeToUpdates(circuit, "STATUS"));
        }

        if (bodyUpdates.length > 0) {
          for (const obj of bodyUpdates) {
            Log.info(
              `[MMM-IntelliCenter] registering for ${obj === poolObjnam ? "pool" : obj === spaObjnam ? "spa" : obj} updates...`,
            );
            await foundUnit.send(
              messages.SubscribeToUpdates(obj, [
                "LOTMP",
                "MODE",
                "STATUS",
                "LSTTMP",
              ]),
            );
          }
        }

        if (chlorinatorObjnam) {
          Log.info(
            "[MMM-IntelliCenter] registering for chlorinator updates...",
          );
          // can also check PRIM, SEC, and SUPER
          // PRIM: percentage output going to primary body (probably pool) on 1-100 scale
          // SEC: percentage output going to secondary body (probably spa) on 1-100 scale
          // SUPER: "ON" or "OFF" for whether currently in superchlorination mode or not
          await foundUnit.send(
            messages.SubscribeToUpdates(chlorinatorObjnam, "SALT"),
          );
        }

        if (intellichemObjnam) {
          Log.info("[MMM-IntelliCenter] registering for chemical updates...");
          await foundUnit.send(
            messages.SubscribeToUpdates(intellichemObjnam, [
              "PHVAL",
              "PHTNK",
              "ORPVAL",
              "QUALTY",
            ]),
          );
        }

        Log.info("[MMM-IntelliCenter] finished initial setup.");
        initialConnectDone = true;
        cb(poolData);
      });

    foundUnit.connect().catch((ex) => {
      Log.error(
        `[MMM-IntelliCenter] error attempting to connect to unit: ${ex}`,
      );
      Log.error(
        `[MMM-IntelliCenter] restarting the connection process in ${reconnectDelayMs / 1000} seconds`,
      );

      unitReconnectTimer = setTimeout(() => {
        this.connect(cb, reconnectCb);
      }, reconnectDelayMs);
    });
  },

  findServer(cb, reconnectCb) {
    Log.info("[MMM-IntelliCenter] starting search for local units");
    const finder = new FindUnits(this.config.multicastInterface);
    finder
      .on("serverFound", (server) => {
        finder.close();
        this.resetFoundUnit();
        Log.info(
          `[MMM-IntelliCenter] local unit found at ${server.addressStr}:${server.port}`,
        );

        foundUnit = new Unit(server.addressStr, server.port);
        this.setupUnit(cb, reconnectCb);
      })
      .on("error", (e) => {
        Log.error(
          `[MMM-IntelliCenter] error trying to find a server. scheduling a retry in ${reconnectDelayMs / 1000} seconds`,
        );
        Log.error(e);
        this.resetFoundUnit();
        setTimeout(() => {
          this.findServer(cb);
        }, reconnectDelayMs);
      });

    finder.search();
    unitFinderRetry = setInterval(() => {
      Log.info(
        `[MMM-IntelliCenter] didn't find any units within ${unitFinderTimeoutMs / 1000} seconds, trying again...`,
      );
      finder.search();
    }, unitFinderTimeoutMs);
  },

  connect(cb, reconnectCb) {
    if (
      !foundUnit &&
      typeof this.config !== "undefined" &&
      this.config.serverAddress &&
      this.config.serverPort
    ) {
      Log.info(
        `[MMM-IntelliCenter] connecting directly to configured unit at ${this.config.serverAddress}:${this.config.serverPort}`,
      );
      foundUnit = new Unit(this.config.serverAddress, this.config.serverPort);
    }

    if (foundUnit) {
      this.setupUnit(cb, reconnectCb);
    } else {
      this.findServer(cb, reconnectCb);
    }
  },
});

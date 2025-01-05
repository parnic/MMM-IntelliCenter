/* global module require clearInterval clearTimeout setTimeout setInterval config */

var NodeHelper = require("node_helper");

let FindUnits;
let Unit;
import("node-intellicenter").then((x) => {
  FindUnits = x.FindUnits;
  Unit = x.Unit;
});
let messages;
import("node-intellicenter/messages").then((x) => {
  messages = x.messages;
});
const Log = require("logger");

const reconnectDelayMs = 10 * 1000;
const unitFinderTimeoutMs = 5 * 1000;
let foundUnit = false;
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
};
let poolObjnam = "B1101";
let spaObjnam = "B1202";
let refreshTimer;
let unitFinderRetry;
let unitReconnectTimer;
let intellichemObjnam = "";
let chlorinatorObjnam = "";
let initialConnectDone = false;

module.exports = NodeHelper.create({
  setCircuit(circuitState) {
    this.setCircuitState(circuitState, (poolStatus) => {
      this.sendSocketNotification("INTELLICENTER_CIRCUIT_DONE", {
        circuitState,
        status: poolStatus,
      });
    });
  },

  setHeatpoint(heatpoint) {
    this.setHeatpointState(heatpoint, (poolStatus) => {
      this.sendSocketNotification("INTELLICENTER_HEATPOINT_DONE", {
        heatpoint,
        status: poolStatus,
      });
    });
  },

  setHeatstate(heatstate) {
    this.setHeatstateState(heatstate, (poolStatus) => {
      this.sendSocketNotification("INTELLICENTER_HEATSTATE_DONE", {
        heatstate,
        status: poolStatus,
      });
    });
  },

  setLightcmd(lightCmd) {
    this.setLights(lightCmd, (poolStatus) => {
      this.sendSocketNotification("INTELLICENTER_LIGHTCMD_DONE", {
        lightCmd,
        status: poolStatus,
      });
    });
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

    foundUnit
      .on("error", (e) => {
        Log.error(
          `[MMM-IntelliCenter] error in unit connection. restarting the connection process in ${reconnectDelayMs / 1000} seconds`,
        );
        Log.error(e);

        reconnectCb();
        this.resetFoundUnit();
        unitReconnectTimer = setTimeout(() => {
          this.connect(cb, reconnectCb);
        }, reconnectDelayMs);
      })
      .on("close", () => {
        Log.error(
          `[MMM-IntelliCenter] unit connection closed unexpectedly. restarting the connection process in ${reconnectDelayMs / 1000} seconds`,
        );

        reconnectCb();
        this.resetFoundUnit();
        unitReconnectTimer = setTimeout(() => {
          this.connect(cb, reconnectCb);
        }, reconnectDelayMs);
      })
      .on("notify", (msg) => {
        // todo: how to find freezeMode on/off?
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
            }
            if (poolData.orp !== 0) {
              poolData.lastOrpVal = poolData.orp;
            }
          } else if (obj.objnam === poolObjnam) {
            Log.info("[MMM-IntelliCenter] received pool update");

            if (obj.params.LOTMP) {
              poolData.poolSetPoint = parseInt(obj.params.LOTMP);
            }
            // todo: HTSRC probably not the right check for this
            if (obj.params.HTSRC) {
              poolData.poolHeaterStatus = obj.params.HTSRC !== "00000";
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
            // todo: HTSRC probably not the right check for this
            if (obj.params.HTSRC) {
              poolData.spaHeaterStatus = obj.params.HTSRC !== "00000";
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

        if (bodyUpdates.length > 0) {
          for (const obj of bodyUpdates) {
            Log.info(
              `[MMM-IntelliCenter] registering for ${obj === poolObjnam ? "pool" : obj === spaObjnam ? "spa" : obj} updates...`,
            );
            await foundUnit.send(
              messages.SubscribeToUpdates(obj, [
                "LOTMP",
                "HTSRC",
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

    foundUnit.connect();
  },

  findServer(cb, reconnectCb) {
    Log.info("[MMM-IntelliCenter] starting search for local units");
    const finder = new FindUnits(this.config.multicastInterface);
    finder
      .on("serverFound", (server) => {
        finder.close();
        Log.info(
          `[MMM-IntelliCenter] local unit found at ${server.addressStr}:${server.port}`,
        );

        foundUnit = new Unit(server.addressStr, server.port);
        this.setupUnit(cb, reconnectCb);

        clearInterval(unitFinderRetry);
        unitFinderRetry = null;
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
      typeof config !== "undefined" &&
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

  setCircuitState(circuitState, cb) {
    if (!foundUnit) {
      cb();
      return;
    }

    Log.info(
      `[MMM-IntelliCenter] setting circuit ${circuitState.id} to ${circuitState.state}`,
    );
    foundUnit.setCircuitState(0, circuitState.id, circuitState.state);
    foundUnit.getPoolStatus();
  },

  setHeatpointState(heatpoint, cb) {
    if (!foundUnit) {
      cb();
      return;
    }

    Log.info(
      `[MMM-IntelliCenter] setting heatpoint for body ${heatpoint.body} to ${heatpoint.temperature} deg`,
    );
    foundUnit.setSetPoint(0, heatpoint.body, heatpoint.temperature);
    foundUnit.getPoolStatus();
  },

  setHeatstateState(heatstate, cb) {
    if (!foundUnit) {
      cb();
      return;
    }

    Log.info(
      `[MMM-IntelliCenter] setting heat state for body ${heatstate.body} to ${heatstate.state}`,
    );
    foundUnit.setHeatMode(0, heatstate.body, heatstate.state);
    foundUnit.getPoolStatus();
  },

  setLights(lightCmd, cb) {
    if (!foundUnit) {
      cb();
      return;
    }

    Log.info(`[MMM-IntelliCenter] sending light command ${lightCmd}`);
    foundUnit.sendLightCommand(0, lightCmd);
    foundUnit.getPoolStatus();
  },
});

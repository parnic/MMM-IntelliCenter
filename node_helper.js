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
const poolData = {};
let refreshTimer;
let unitFinderRetry;
let unitReconnectTimer;

module.exports = NodeHelper.create({
  setCircuit(circuitState) {
    this.setCircuitState(circuitState, (poolStatus) => {
      this.sendSocketNotification("INTELLICENTER_CIRCUIT_DONE", {
        circuitState,
        status: poolStatus
      });
    });
  },

  setHeatpoint(heatpoint) {
    this.setHeatpointState(heatpoint, (poolStatus) => {
      this.sendSocketNotification("INTELLICENTER_HEATPOINT_DONE", {
        heatpoint,
        status: poolStatus
      });
    });
  },

  setHeatstate(heatstate) {
    this.setHeatstateState(heatstate, (poolStatus) => {
      this.sendSocketNotification("INTELLICENTER_HEATSTATE_DONE", {
        heatstate,
        status: poolStatus
      });
    });
  },

  setLightcmd(lightCmd) {
    this.setLights(lightCmd, (poolStatus) => {
      this.sendSocketNotification("INTELLICENTER_LIGHTCMD_DONE", {
        lightCmd,
        status: poolStatus
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
          }
        );
      } else if (poolData.status) {
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

    foundUnit
      .on("error", (e) => {
        Log.error(
          `[MMM-IntelliCenter] error in unit connection. restarting the connection process in ${reconnectDelayMs / 1000} seconds`
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
          `[MMM-IntelliCenter] unit connection closed unexpectedly. restarting the connection process in ${reconnectDelayMs / 1000} seconds`
        );

        reconnectCb();
        this.resetFoundUnit();
        unitReconnectTimer = setTimeout(() => {
          this.connect(cb, reconnectCb);
        }, reconnectDelayMs);
      })
      .once("connected", () => {
        Log.info(
          "[MMM-IntelliCenter] logged into unit. getting basic configuration..."
        );
        foundUnit.send(new messages.GetSystemInformation()).then(() => {
          Log.info("[MMM-IntelliCenter] got it!");
        });
      })
      .once("controllerConfig", (config) => {
        Log.info(
          "[MMM-IntelliCenter] configuration received. adding client..."
        );
        poolData.controllerConfig = config;
        poolData.degStr = this.config.degC ? "C" : "F";
        foundUnit.addClient(1234);
      })
      .once("addClient", () => {
        Log.info(
          "[MMM-IntelliCenter] client added successfully and listening for changes"
        );
        foundUnit.getPoolStatus();
        // Connection seems to time out every 10 minutes without some sort of request made
        refreshTimer = setInterval(
          () => {
            foundUnit.pingServer();
          },
          1 * 60 * 1000
        );
      })
      .on("poolStatus", (status) => {
        Log.info("[MMM-IntelliCenter] received pool status update");
        poolData.status = status;
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
          `[MMM-IntelliCenter] local unit found at ${server.addressStr}:${server.port}`
        );

        foundUnit = new Unit(server.addressStr, server.port);
        this.setupUnit(cb, reconnectCb);

        clearInterval(unitFinderRetry);
        unitFinderRetry = null;
      })
      .on("error", (e) => {
        Log.error(
          `[MMM-IntelliCenter] error trying to find a server. scheduling a retry in ${reconnectDelayMs / 1000} seconds`
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
        `[MMM-IntelliCenter] didn't find any units within ${unitFinderTimeoutMs / 1000} seconds, trying again...`
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
        `[MMM-IntelliCenter] connecting directly to configured unit at ${this.config.serverAddress}:${this.config.serverPort}`
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
      `[MMM-IntelliCenter] setting circuit ${circuitState.id} to ${circuitState.state}`
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
      `[MMM-IntelliCenter] setting heatpoint for body ${heatpoint.body} to ${heatpoint.temperature} deg`
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
      `[MMM-IntelliCenter] setting heat state for body ${heatstate.body} to ${heatstate.state}`
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
  }
});

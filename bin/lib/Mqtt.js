const mqtt = require('mqtt');
const _ = require('lodash');

module.exports = class Mqtt {
  constructor(globalConfig, pluginConfig = {}) {
    this.pluginConfig = pluginConfig;
    this.setConfig(globalConfig);
  }

  setPluginConfig(pluginConfig = {}) {
    this.pluginConfig = pluginConfig;
  }

  setConfig(globalConfig) {
    this.config = _.get(globalConfig, 'Mqtt', null);
  }

  resolveConnectionConfig() {
    if (_.get(this.pluginConfig, 'mqttMode', 'loxberry') === 'custom') {
      return {
        host: _.get(this.pluginConfig, 'mqttHost', ''),
        port: _.get(this.pluginConfig, 'mqttPort', ''),
        username: _.get(this.pluginConfig, 'mqttUser', ''),
        password: _.get(this.pluginConfig, 'mqttPassword', ''),
        clientId: _.get(this.pluginConfig, 'mqttClientId', 'UniFiPresenceNG')
      };
    }

    return {
      host: _.get(this.config, 'Brokerhost', ''),
      port: _.get(this.config, 'Brokerport', ''),
      username: _.get(this.config, 'Brokeruser', ''),
      password: _.get(this.config, 'Brokerpass', ''),
      clientId: 'UniFiPresenceNG'
    };
  }

  async connect() {
    const broker = this.resolveConnectionConfig();
    if (!broker.host || !broker.port || !broker.username || !broker.password) {
      throw new Error('Cant connect to MQTT. Configuration is missing');
    }
    const connectUrl = `mqtt://${broker.host}:${broker.port}`;

    return new Promise(
      function (resolve, reject) {
        this.client = mqtt.connect(connectUrl, {
          username: broker.username,
          password: broker.password,
          clientId: broker.clientId,
          keepalive: 300,
          reconnectPeriod: 5000,
          queueQoSZero: true
        });

        this.client.once('connect', () => {
          console.log(`MQTT connected to ${connectUrl}`);
          resolve();
        });
        this.client.once('error', (error) => {
          reject(error);
        });
        this.client.on('packetreceive', () => {});
      }.bind(this)
    );
  }

  disconnect() {
    if (!this.client) return;
    this.client.end();
  }

  send(topic, message) {
    if (!this.client) return;
    if (!this.client.connected) {
      this.client.reconnect();
    }
    this.client.publish(topic, message, (error) => {
      if (error) {
        console.log(`MQTT publish failed for ${topic}: ${error.message}`);
      }
    });
  }
};

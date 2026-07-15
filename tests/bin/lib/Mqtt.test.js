const Mqtt = require('../../../bin/lib/Mqtt');
const mqtt = require('../../../bin/node_modules/mqtt');
jest.mock('../../../bin/node_modules/mqtt');
describe('MQTT', () => {
  let globalConfig, mqttInstance, mqttClient;
  beforeEach(() => {
    globalConfig = {
      Mqtt: {
        Brokeruser: 'user',
        Brokerpass: 'password',
        Brokerhost: 'localhost',
        Brokerport: 7721
      }
    };
    mqttClient = {
      end: jest.fn().mockName('mqtt.end'),
      publish: jest.fn().mockName('mqtt.publish'),
      reconnect: jest.fn().mockName('mqtt.reconnect'),
      once: jest.fn().mockImplementation((event, callback) => {
        if (event === 'connect') callback();
      }),
      on: jest.fn().mockImplementation((event, callback) => {
        if (event === 'connect') callback();
      }),
      connected: true
    };
    mqtt.connect.mockReturnValue(mqttClient);
    mqttInstance = new Mqtt(globalConfig);
  });
  afterEach(() => {
    jest.resetAllMocks();
  });
  describe('constructor', () => {
    it('should set the config', () => {
      expect(mqttInstance.config).toEqual(globalConfig.Mqtt);
    });
    it('supports plugin config injection', () => {
      const pluginConfig = { mqttMode: 'custom' };
      const instance = new Mqtt(globalConfig, pluginConfig);
      expect(instance.pluginConfig).toEqual(pluginConfig);
    });
  });
  describe('connect', () => {
    it('connects with loxberry broker config', async () => {
      await mqttInstance.connect();
      expect(mqtt.connect).toHaveBeenCalledWith('mqtt://localhost:7721', {
        clientId: 'UniFiPresenceNG',
        keepalive: 300,
        password: 'password',
        queueQoSZero: true,
        reconnectPeriod: 5000,
        username: 'user'
      });
    });
    it('stores the connection', async () => {
      await mqttInstance.connect();
      expect(mqttInstance.client).toEqual(mqttClient);
    });
    it('throws when loxberry mqtt config is incomplete', async () => {
      mqttInstance.setConfig({ Mqtt: { Brokerhost: 'localhost' } });
      await expect(mqttInstance.connect()).rejects.toEqual(Error('Cant connect to MQTT. Configuration is missing'));
    });
    it('connects with custom broker config', async () => {
      mqttInstance.setPluginConfig({
        mqttMode: 'custom',
        mqttHost: 'custom-host',
        mqttPort: 1885,
        mqttUser: 'custom-user',
        mqttPassword: 'custom-password',
        mqttClientId: 'custom-client'
      });

      await mqttInstance.connect();

      expect(mqtt.connect).toHaveBeenCalledWith('mqtt://custom-host:1885', {
        clientId: 'custom-client',
        keepalive: 300,
        password: 'custom-password',
        queueQoSZero: true,
        reconnectPeriod: 5000,
        username: 'custom-user'
      });
    });
  });
  describe('disconnect', () => {
    it('disconnects', () => {
      mqttInstance.client = mqttClient;
      mqttInstance.disconnect();
      expect(mqttClient.end).toHaveBeenCalled();
    });
    it('does nothing when client is missing', () => {
      mqttInstance.client = null;
      mqttInstance.disconnect();
      expect(mqttClient.end).not.toHaveBeenCalled();
    });
  });
  describe('send', () => {
    it('does not send when the client is missing', () => {
      mqttInstance.client = null;
      mqttInstance.send('foo');
      expect(mqttClient.publish).not.toHaveBeenCalled();
    });
    it('reconnects when the client is disconnected', () => {
      mqttInstance.client = mqttClient;
      mqttInstance.client.connected = false;
      mqttInstance.send('foo', 'message');
      expect(mqttClient.reconnect).toHaveBeenCalled();
      expect(mqttClient.publish).toHaveBeenCalledWith('foo', 'message', expect.any(Function));
    });
    it('sends the message', () => {
      mqttInstance.client = mqttClient;
      mqttInstance.send('topic', 'the message');
      expect(mqttClient.reconnect).not.toHaveBeenCalled();
      expect(mqttClient.publish).toHaveBeenCalledWith('topic', 'the message', expect.any(Function));
    });
  });
});

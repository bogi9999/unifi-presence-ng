const config = require('../../bin/unifi.config');
describe('unifi pm2 config', () => {
  it('should be as expected', () => {
    expect(config).toEqual([
      {
        name: 'UniFi Event Server',
        script: 'index.js',
        cwd: expect.any(String),
        env: {
          NODE_ENV: expect.any(String)
        },
        out_file: expect.any(String),
        error_file: expect.any(String),
        pid_file: expect.any(String),
        watch: false
      }
    ]);
  });
});

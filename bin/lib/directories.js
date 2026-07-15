const path = require('path');
const PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.LBHOMEDIR || process.env.HOME === '/opt/loxberry';

const directories = () => {
  if (PRODUCTION) {
    return {
      config: 'REPLACELBPCONFIGDIR',
      data: 'REPLACELBPDATADIR',
      logdir: 'REPLACELBPLOGDIR',
      homedir: process.env.LBHOMEDIR || '/opt/loxberry'
    };
  }

  return {
    config: path.join(__dirname, '../../config'),
    data: path.join(__dirname, '../../data'),
    logdir: path.join(__dirname, '../../loxberry/logs'),
    homedir: path.join(__dirname, '../../loxberry')
  };
};

module.exports = directories();

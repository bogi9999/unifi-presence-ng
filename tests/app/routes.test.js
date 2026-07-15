import routes from '../../app/routes';
describe.skip('Routes', () => {
  it('defines all routes', () => {
    expect(routes).toEqual([
      {
        path: '/',
        component: expect.objectContaining({ name: 'Page' }),
        children: [
          {
            path: '/settings',
            component: expect.objectContaining({ name: 'Settings' })
          },
          {
            path: '/devices',
            component: expect.objectContaining({ name: 'Devices' })
          }
        ]
      }
    ]);
  });
});

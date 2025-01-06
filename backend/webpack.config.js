module.exports = {
  // ...existing code...
  devServer: {
    // ...existing code...
    setupMiddlewares: (middlewares, devServer) => {
      // Replace onBeforeSetupMiddleware
      // devServer.app.use(/* your middleware */);

      // Replace onAfterSetupMiddleware
      // devServer.app.use(/* your middleware */);

      return middlewares;
    },
    // ...existing code...
  },
  // ...existing code...
};

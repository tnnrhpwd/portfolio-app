module.exports = {
  // ...existing code...
  devServer: {
    // ...existing code...
    setupMiddlewares: (middlewares, devServer) => {
      // Custom middleware can be added here
      return middlewares;
    },
    // ...existing code...
  },
  // ...existing code...
};

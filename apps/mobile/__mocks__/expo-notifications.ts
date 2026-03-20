const mockSubscription = { remove: jest.fn() };

module.exports = {
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: "mock-expo-push-token" }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue(mockSubscription),
  setNotificationHandler: jest.fn(),
};

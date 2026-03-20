const mockDb = {
  execSync: jest.fn(),
  runSync: jest.fn(),
  getFirstSync: jest.fn(),
  getAllSync: jest.fn().mockReturnValue([]),
};

export const openDatabaseSync = jest.fn().mockReturnValue(mockDb);

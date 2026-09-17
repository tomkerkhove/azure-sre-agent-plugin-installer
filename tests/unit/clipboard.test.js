const { copyToClipboard } = require("../../assets/app.js");

const originalNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
const originalWindow = Object.getOwnPropertyDescriptor(global, "window");
const originalDocument = Object.getOwnPropertyDescriptor(global, "document");

function setGlobal(name, value) {
  Object.defineProperty(global, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(global, name, descriptor);
  } else {
    delete global[name];
  }
}

describe("copyToClipboard", () => {
  afterEach(() => {
    restoreGlobal("navigator", originalNavigator);
    restoreGlobal("window", originalWindow);
    restoreGlobal("document", originalDocument);
  });

  test("propagates native clipboard rejections", async () => {
    const error = new Error("Clipboard unavailable");
    setGlobal("window", { isSecureContext: true });
    setGlobal("navigator", {
      clipboard: { writeText: jest.fn().mockRejectedValue(error) },
    });

    await expect(copyToClipboard("badge markdown")).rejects.toBe(error);
  });

  test("rejects when the fallback copy returns false", async () => {
    const textarea = {
      style: {},
      focus: jest.fn(),
      select: jest.fn(),
    };
    const removeChild = jest.fn();
    setGlobal("window", { isSecureContext: false });
    setGlobal("navigator", {});
    setGlobal("document", {
      createElement: jest.fn(() => textarea),
      execCommand: jest.fn(() => false),
      body: {
        appendChild: jest.fn(),
        removeChild,
      },
    });

    await expect(copyToClipboard("badge markdown")).rejects.toThrow(
      "Clipboard copy failed"
    );
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });

  test("propagates fallback copy errors and removes the temporary element", async () => {
    const error = new Error("Copy command unavailable");
    const textarea = {
      style: {},
      focus: jest.fn(),
      select: jest.fn(),
    };
    const removeChild = jest.fn();
    setGlobal("window", { isSecureContext: false });
    setGlobal("navigator", {});
    setGlobal("document", {
      createElement: jest.fn(() => textarea),
      execCommand: jest.fn(() => {
        throw error;
      }),
      body: {
        appendChild: jest.fn(),
        removeChild,
      },
    });

    await expect(copyToClipboard("badge markdown")).rejects.toBe(error);
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });
});

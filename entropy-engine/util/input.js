import { v2 } from "./maths/maths.js";
import { Sprite } from "../ECS/sprite.js";
import { Camera } from "../ECS/components/camera.js";
import { screenSpaceToWorldSpace } from "./util.js";
export function getMousePos(canvas, event) {
    let rect = canvas.getBoundingClientRect();
    const pos = new v2(event.pageX - rect.left - scrollX, 
    // invert
    rect.height - (event.pageY - rect.top - scrollY));
    const scale = new v2(canvas.width / rect.width, canvas.height / rect.height);
    pos.mul(scale);
    return pos;
}
export function getMousePosWorldSpace(canvas, event) {
    const mousePos = getMousePos(canvas, event);
    return screenSpaceToWorldSpace(mousePos, Camera.main, canvas);
}
export const input = {
    listen: (type, handler) => {
        // @ts-ignore
        document.addEventListener(type, handler);
    },
    'mouseDown': false,
    'cursorPosition': v2.zero,
    'cursorPosWorldSpace': v2.zero
};
// init input for keycodes
for (let i = 8; i < 123; i++) {
    input[i] = false;
    input[String.fromCharCode(i)] = i;
}
input.Space = 32;
input.Enter = 13;
input.Shift = 16;
input.Backspace = 8;
input.Ctrl = 17;
input.Alt = 18;
input.CmdR = 93;
input.CmdL = 91;
input.WindowsKey = 91;
input.Left = 37;
input.Right = 39;
input.Up = 38;
input.Down = 40;
document.addEventListener('keydown', event => {
    input[event.keyCode] = true;
});
document.addEventListener('keyup', event => {
    input[event.keyCode] = false;
});
document.addEventListener('keypress', event => {
    Sprite.loop(sprite => {
        if (!sprite.hasComponent('GUIElement', 'GUITextBox'))
            return;
        const element = sprite.getComponent('GUIElement', 'GUITextBox');
        if (element.selected)
            element.keyPress(event);
    });
});
// for backspace and enter
// backspace: delete last character on selected text boxes
// enter:     unselect all text boxes
document.addEventListener('keydown', event => {
    if (event.keyCode !== 8)
        return;
    Sprite.loop(sprite => {
        if (!sprite.hasComponent('GUIElement', 'GUITextBox'))
            return;
        const element = sprite.getComponent('GUIElement', 'GUITextBox');
        if (element.selected)
            element.backspace();
    });
});
export function setMousePos(event, canvas) {
    input.cursorPosition = getMousePos(canvas, event);
    input.cursorPosWorldSpace = getMousePosWorldSpace(canvas, event);
}

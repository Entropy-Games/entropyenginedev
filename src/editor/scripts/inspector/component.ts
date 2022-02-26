import {reRender, rightClickOption, setRightClick} from "../renderer.js";
import {state} from "../state.js";
import {_componentProperty_} from "./property.js";

export const _component_ = (component, i) => {
	const cName = component.subtype || component.type;
	i.append(`
            <div id="component-${cName}">
                <p class="subheader" id="component-${cName}-title" style="
                    background: vaR(--input-opposite-bg);
                    margin-top: 10px;
                    border-top: 1px solid vaR(--text-colour);
                    padding: 2px 0;
                ">
                    ${cName}
                </p>
            </div>
        `);

	if (cName !== 'Transform') {
		setRightClick(`component-${cName}-title`, state.selectedEntity, `
             ${rightClickOption(`remove-${cName}`, () => {
				let index = state.selectedEntity.components.indexOf(component);
				if (index === -1) {
					console.error('No component found to delete: ' + component);
					return;
				}
				
				delete state.selectedEntity.components.splice(index, 1)[0];
	
				reRender();
			}, 'remove')}
		`);
	}

	const componentHTML = $(`#component-${cName}`);

	let j = 0;
	for (let property of component.public) {
		let name = component.type;
		if (name === 'Script')
			name = component?.scriptName || component?.name || component.subtype;

		componentHTML.append(`
                <div style="border-bottom: 1px solid vaR(--input-bg); margin-bottom: 4px">
                    ${_componentProperty_(
						property,
						'value',
						name,
						['public', j],
						property.name,
						property.type
					)}
                </div>
            `);

		j++;
	}
};
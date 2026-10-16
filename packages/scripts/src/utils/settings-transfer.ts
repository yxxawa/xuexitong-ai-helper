/** Settings backups contain declared user preferences, never live requests, leases or answer caches. */
export interface SettingDefinition {
	defaultValue: unknown;
	label?: string;
	tag?: string;
	attrs?: { type?: string; min?: string | number; max?: string | number; step?: string | number };
	options?: (unknown[] | { value: string; label: string; title?: string })[];
	extra?: { appConfigSync?: boolean };
}
export type SettingsSchema = Record<string, SettingDefinition>;
export function settingsSchema(
	scripts: { namespace?: string; configs?: Record<string, SettingDefinition | undefined> }[]
): SettingsSchema {
	const schema: SettingsSchema = Object.create(null);
	for (const script of scripts) {
		if (!script.namespace) continue;
		for (const [name, field] of Object.entries(script.configs || {})) {
			if (
				!field?.label ||
				field.extra?.appConfigSync === false ||
				['button', 'hidden'].includes(field.attrs?.type || '')
			)
				continue;
			if (!['string', 'number', 'boolean'].includes(typeof field.defaultValue) && !Array.isArray(field.defaultValue))
				continue;
			schema[script.namespace + '.' + name] = field;
		}
	}
	return schema;
}
function valueFor(key: string, value: unknown, field: SettingDefinition): unknown {
	const fail = () => {
		throw new Error('设置值无效：' + (field.label || key));
	};
	if (field.options?.length) {
		if (typeof value !== 'string' && typeof value !== 'number') return fail();
		const optionValues = field.options.map((option) => (Array.isArray(option) ? option[0] : option.value));
		const index = optionValues.findIndex((option) => String(option) === String(value));
		return index >= 0 ? optionValues[index] : fail();
	}
	if (typeof field.defaultValue === 'number') {
		// Legacy form controls sometimes stored numbers as strings.
		if (typeof value === 'string' && value.trim() && /^[-+]?\d+(?:\.\d+)?$/.test(value)) value = Number(value);
		if (
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			(field.attrs?.min !== undefined && value < Number(field.attrs.min)) ||
			(field.attrs?.max !== undefined && value > Number(field.attrs.max)) ||
			(field.attrs?.step === 1 && !Number.isInteger(value))
		)
			return fail();
		return value;
	}
	if (Array.isArray(field.defaultValue)) {
		if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return fail();
		return [...value];
	}
	return typeof value === typeof field.defaultValue ? value : fail();
}
export function exportSettings(schema: SettingsSchema, read: (key: string) => unknown) {
	const values: Record<string, unknown> = Object.create(null);
	for (const [key, field] of Object.entries(schema)) {
		const stored = read(key);
		values[key] = valueFor(key, stored === undefined ? field.defaultValue : stored, field);
	}
	return { format: 'xuexitong-ai-helper-settings', version: 1, values };
}
/** Validate the entire file before the caller writes any value. Unrecognized legacy keys are ignored. */
export function parseSettings(
	text: string,
	schema: SettingsSchema
): { values: Record<string, unknown>; ignored: number } {
	if (text.length > 2 * 1024 * 1024) throw new Error('设置文件过大，请选择本程序导出的设置备份。');
	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('设置文件不是有效的 JSON，未更改当前设置。');
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('设置文件格式无效。');
	if (Object.hasOwnProperty.call(data, 'format') || Object.hasOwnProperty.call(data, 'version')) {
		if (
			data.format !== 'xuexitong-ai-helper-settings' ||
			data.version !== 1 ||
			!data.values ||
			typeof data.values !== 'object' ||
			Array.isArray(data.values)
		)
			throw new Error('不支持此设置备份版本。');
		data = data.values;
	}
	const values: Record<string, unknown> = Object.create(null);
	let ignored = 0;
	for (const [key, value] of Object.entries(data)) {
		if (!Object.hasOwnProperty.call(schema, key)) {
			ignored++;
			continue;
		}
		values[key] = valueFor(key, value, schema[key]);
	}
	if (!Object.keys(values).length) throw new Error('文件中没有可导入的本程序设置。');
	return { values, ignored };
}

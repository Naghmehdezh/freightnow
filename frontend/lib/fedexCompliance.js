// Exact wording and size required by FedEx Integrator validation: no leading "The", 8pt font.
export const FEDEX_DISCLAIMER = 'FedEx service marks are owned by Federal Express Corporation and are used by permission.';
export const FEDEX_DISCLAIMER_STYLE = { fontSize: '8pt', color: 'var(--text3)', lineHeight: 1.4 };

// FedEx Standard End User License Agreement (EULA) for Hosted 3rd-party Solutions — FedEx's own
// PDF, shown page by page (with the revision footer on each page) by FedexEulaViewer, so the text
// is always exactly FedEx's current version. Source:
// https://www.fedex.com/content/dam/fedex-com/hdn/FedEx_Standard_End_User_License_Agreement_EULA_for_Hosted_3rd_party_solutions.pdf
export const FEDEX_EULA_PDF_URL = '/legal/FedEx_EULA_3rd_Party_Hosted_2002382_v4_June_2024.pdf';
export const FEDEX_EULA_REVISION = 'FedEx Form No. 2002382 v 4 June 2024 Rev';

// Exact wording required by FedEx Integrator validation.
export const FEDEX_EULA_CHECKBOX_LABEL = 'I acknowledge that I have read the FedEx EULA';
export const FEDEX_EULA_ACCEPT_BUTTON = 'I accept the terms of the FedEx EULA to start shipping';
export const FEDEX_VALIDATION_FAILED_MESSAGE = 'We are unable to process this request. Please try again later or call FedEx Customer Service and ask for technical support.';

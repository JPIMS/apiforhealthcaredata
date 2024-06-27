import {
  _xmlnsSdtcAttribute,
  _xmlnsXsiAttribute,
  _xsiTypeAttribute,
} from "../cda-templates/constants";

export type ClinicalDocument = {
  ClinicalDocument: {
    _xmlns: string;
    [_xmlnsSdtcAttribute]: string;
    [_xmlnsXsiAttribute]: string;
    _moodCode: string;
    realmCode?: CdaCodeCe;
    typeId?: CdaInstanceIdentifier;
    templateId?: CdaInstanceIdentifier[];
    id: CdaInstanceIdentifier;
    code: CdaCodeCe;
    title?: string;
    effectiveTime: Entry;
    confidentialityCode: CdaCodeCe;
    languageCode?: CdaCodeCe;
    setId?: CdaInstanceIdentifier;
    versionNumber?: Entry;
    recordTarget: CdaRecordTarget;
    author: CdaAuthor;
    custodian: CdaCustodian;
    componentOf: EncompassingEncounter | undefined;
    component: unknown;
  };
};

export type ActStatusCode =
  | "new"
  | "active"
  | "held"
  | "completed"
  | "nullified"
  | "completed"
  | "suspended";

export type CdaAddressUse =
  | "BAD"
  | "CONF"
  | "DIR"
  | "H"
  | "HP"
  | "HV"
  | "PHYS"
  | "PST"
  | "PUB"
  | "TMP"
  | "WP";

export type CdaGender = "M" | "F" | "UK";
export type CdaTelecomUse = "AS" | "EC" | "HP" | "HV" | "MC" | "PG" | "WP";
export type Entry = { [key: string]: string } | string;
export type EntryObject = { [key: string]: string };

export type CdaTelecom = {
  _use?: EntryObject;
  _value?: EntryObject;
};

export type CdaPeriod = {
  low?: Entry;
  high?: Entry;
};

export type CdaAddress = {
  _use?: string;
  streetAddressLine?: Entry | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
  country?: string | undefined;
  useablePeriod?: CdaPeriod | undefined;
};

export type CdaOrganization = {
  id?: CdaInstanceIdentifier[] | Entry;
  name?: Entry | undefined;
  telecom?: CdaTelecom[] | undefined;
  addr?: CdaAddress[] | undefined;
};

export type CdaAssignedAuthor = {
  id: Entry;
  addr?: CdaAddress[] | undefined;
  telecom?: CdaTelecom[] | undefined;
  representedOrganization?: CdaOrganization | undefined;
};

export type CdaPatientRole = {
  name?: CdaName[] | undefined;
  administrativeGenderCode?: EntryObject;
  birthTime?: EntryObject;
  deceasedInd?: EntryObject;
  maritalStatusCode?: EntryObject | CdaCodeCe;
  languageCommunication?: {
    languageCode: EntryObject | CdaCodeCe;
  };
};

export type CdaName = {
  use?: EntryObject;
  given?: Entry;
  family?: string | undefined;
  validTime: CdaPeriod;
};

export type CdaOriginalText = {
  reference: {
    _value: string;
  };
};

// Ce (CE) stands for Coded with Equivalents
export type CdaCodeCe = {
  _code?: string;
  _codeSystem?: string;
  _codeSystemName?: string;
  _displayName?: string;
};

// St (ST) stands for Simple Text
export type CdaValueSt = {
  [_xsiTypeAttribute]?: "ST";
  [_xmlnsXsiAttribute]?: string;
  "#text"?: string;
};

// Cd (CD) stands for Concept Descriptor
export type CdaValueCd = {
  [_xsiTypeAttribute]: "CD";
  _code?: string | undefined;
  _displayName?: string | undefined;
  _codeSystem?: string | undefined;
  originalText?: CdaOriginalText;
};

export type CdaValuePq = {
  [_xsiTypeAttribute]: "PQ";
  _unit?: string | undefined;
  _value: number;
};

// Cv (CV) stands for Coded Value
export interface CdaCodeCv extends CdaCodeCe {
  originalText?: CdaOriginalText | string | undefined;
  translation?: CdaCodeCe[] | undefined;
}

/**
 * @see https://build.fhir.org/ig/HL7/CDA-core-sd/StructureDefinition-II.html
 */
export type CdaInstanceIdentifier = {
  _root?: string;
  _extension?: string;
  _assigningAuthorityName?: string;
};

// TOP Level CDA Section Types
export type CdaAuthor = {
  time: Entry;
  assignedAuthor: CdaAssignedAuthor;
};

export type CdaCustodian = {
  assignedCustodian: {
    representedCustodianOrganization: CdaOrganization | undefined;
  };
};

export type CdaRecordTarget = {
  patientRole: {
    id?: CdaInstanceIdentifier[] | Entry;
    addr?: CdaAddress[] | undefined;
    telecom?: CdaTelecom[] | undefined;
    patient: CdaPatientRole;
  };
};

export type CreateTableRowsCallback<T> = (
  observation: T,
  sectionPrefix: string
) => ObservationTableRow | ObservationTableRow[];

export type CreateEntriesCallback<T, R> = (aug: T, sectionPrefix: string) => R;

export type TableRowsAndEntriesResult<D> = {
  trs: ObservationTableRow[];
  entries: D[];
};

export type ObservationTableRow = {
  tr: {
    _ID: string;
    td: {
      _ID?: string;
      "#text"?: string | undefined;
    }[];
  };
};

export type EffectiveTime = {
  low?: EntryObject;
  high?: EntryObject;
};

export type ObservationEntry = {
  _inversionInd?: boolean;
  _typeCode?: string;
  observation: {
    _classCode: string;
    _moodCode: string;
    templateId?: {
      _root?: string;
      _extension?: string;
    };
    id?: {
      _nullFlavor?: string;
      _root?: string;
      _extension?: string;
    };
    code?: CdaCodeCe | CdaCodeCv;
    text?: {
      reference?: {
        _value?: string | undefined;
      };
      "#text"?: string | undefined;
    };
    statusCode?: {
      _code: string;
    };
    effectiveTime?: {
      _value?: string | undefined;
    };
    value?: CdaValuePq | CdaValuePq[] | CdaValueCd | CdaValueCd[] | undefined;
    participant?: Participant | undefined;
    entryRelationship?: ObservationEntryRelationship[];
    interpretationCode?: CdaCodeCe;
  };
};

export type ObservationEntryRelationship = ObservationEntry & {
  _typeCode?: string;
  code?: CdaCodeCv | undefined;
  value?: CdaValueCd[] | undefined;
};

export type Participant = {
  _typeCode: string;
  _contextControlCode?: string;
  participantRole: {
    id?: CdaInstanceIdentifier[] | Entry;
    _classCode?: string;
    templateId?: {
      _root?: string;
    };
    code?: CdaCodeCv | Entry | undefined;
    addr?: CdaAddress[] | undefined;
    telecom?: CdaTelecom[] | undefined;
    playingEntity?: {
      _classCode?: string;
      code?: CdaCodeCv | undefined;
      name?: {
        "#text": string;
      };
    };
  };
};

export type SubstanceAdministationEntry = {
  substanceAdministration: {
    _classCode: string;
    _moodCode: string;
    templateId?: {
      _root?: string;
      _extension?: string;
    };
    id?: {
      _root?: string;
      _extension?: string;
    };
    statusCode: {
      _code?: string | undefined;
    };
    effectiveTime: {
      [_xsiTypeAttribute]: string;
      low: {
        _value?: string | undefined;
      };
      high: {
        _value?: string | undefined;
      };
    };
    consumable: {
      _typeCode: string;
      manufacturedProduct: {
        templateId?: {
          _root?: string;
          _extension?: string;
        };
        manufacturedMaterial?: {
          code: CdaCodeCv | undefined;
        };
      };
    };
    // participant: Participant;
    entryRelationship?: {
      supply?: {
        _classCode: string;
        _moodCode: string;
      };
    };
  };
};

export type ConcernActEntry = {
  _typeCode?: string;
  act: {
    _classCode: string;
    _moodCode: string;
    templateId: CdaInstanceIdentifier;
    id?: CdaInstanceIdentifier;
    code?: CdaCodeCe;
    statusCode?: {
      _code: string;
    };
    effectiveTime?: {
      low?: EntryObject;
      high?: EntryObject;
    };
    entryRelationship: ObservationEntryRelationship;
  };
};

export type EncounterEntry = {
  encounter: {
    _classCode?: string;
    _moodCode?: string;
    templateId?: CdaInstanceIdentifier;
    id?: CdaInstanceIdentifier;
    code: CdaCodeCv;
    statusCode?: {
      _code: string;
    };
    effectiveTime?: EffectiveTime;
    performer?: AssignedEntity[];
    participant?: Participant[] | undefined;
    entryRelationship: ConcernActEntry | ConcernActEntry[];
  };
};

export type AssignedPerson = {
  name: {
    given?: string | undefined;
    family?: string | undefined;
  };
};

export type RepresentedOrganization = {
  _classCode: string;
  name?: {
    "#text": string;
  };
  addr?: CdaAddress[] | undefined;
  telecom?: CdaTelecom[] | undefined;
};

export type AssignedEntity = {
  assignedEntity: {
    id?: CdaInstanceIdentifier | undefined;
    addr?: CdaAddress[] | undefined;
    code?: CdaCodeCv | CdaCodeCv[] | undefined;
    telecom?: CdaTelecom[] | undefined;
    assignedPerson?: AssignedPerson | undefined;
    representedOrganization?: RepresentedOrganization;
  };
};

export type ObservationOrganizer = {
  _typeCode?: string;
  organizer: {
    _classCode: string;
    _moodCode: string;
    templateId: CdaInstanceIdentifier;
    id?: CdaInstanceIdentifier;
    code?: CdaCodeCe;
    statusCode: {
      _code?: string | undefined;
    };
    effectiveTime?: {
      _value?: string | undefined;
    };
    subject?: {
      relatedSubject?: {
        code: CdaCodeCv | undefined;
        subject: Subject;
      };
    };
    component?: ObservationEntry[] | undefined;
  };
};

export type ResponsibleParty = {
  assignedEntity: {
    id: CdaInstanceIdentifier;
    addr?: CdaAddress[] | undefined;
    telecom?: CdaTelecom[] | undefined;
    assignedPerson?: AssignedPerson | undefined;
    representedOrganization?: {
      name?: string;
    };
  };
};

export type HealthCareFacility = {
  id: CdaInstanceIdentifier;
  location: {
    name: string | undefined;
    addr: CdaAddress[] | undefined;
  };
};

export type EncompassingEncounter = {
  encompassingEncounter: {
    id: CdaInstanceIdentifier;
    code: CdaCodeCv;
    effectiveTime: {
      low: EntryObject;
      high: EntryObject;
    };
    responsibleParty: ResponsibleParty | undefined;
    location: {
      healthCareFacility: HealthCareFacility;
    };
  };
};

export type Subject = {
  name?: string | undefined;
  administrativeGenderCode?: CdaCodeCe | undefined;
  birthTime?: Entry | undefined;
  deceasedInd?:
    | {
        _value?: boolean | undefined;
        [_xmlnsSdtcAttribute]: string;
      }
    | undefined;
};

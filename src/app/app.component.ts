import { COMMA, ENTER } from "@angular/cdk/keycodes"
import { Component, ElementRef, ViewChild } from "@angular/core"
import { FormBuilder, FormGroup, Validators, FormControl } from "@angular/forms"
import { ActivatedRoute, Router } from "@angular/router"

import {
  MatAutocompleteSelectedEvent,
  MatChipInputEvent,
  MatAutocomplete,
  MatRadioButton,
  MatRadioGroup,
} from "@angular/material"
import { Observable, Subject, of } from "rxjs"
import { HttpClient, HttpParams } from "@angular/common/http"
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  tap,
  map,
  finalize,
} from "rxjs/operators"

import {
  HCC_LABELS as HCC_LABELS_V22,
  HCC_GRAPH as HCC_GRAPH_V22,
} from "./data/hccs_v22"

import {
  HCC_LABELS as HCC_LABELS_V23,
  HCC_GRAPH as HCC_GRAPH_V23,
} from "./data/hccs_v23"

import * as shape from "d3-shape"
class IcdCode {
  code: string
  description: string
  hccs: number[]
  is_billable: Boolean
}
@Component({
  selector: "app-root",
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.less"],
})
export class AppComponent {
  separatorKeysCodes: number[] = [ENTER, COMMA]

  searchTerms = new Subject<string>()
  icdCodes$: Observable<IcdCode[]>

  selectedDiagnoses: string[] = []

  selected_hcc_labels: any
  selected_hcc_list: string[]
  hcc_list_model_year: string = "2019"

  hcc_labels = HCC_LABELS_V23 //default labels for RAF calculator
  hcc_labels_v22: any
  hcc_list_v22: string[]
  hcc_labels_v23: any
  hcc_list_v23: string[]

  hcc_to_icd_list$: any
  code_map: any

  rafScore: any = null

  isRafLoading: boolean
  isIcdLoading: boolean

  @ViewChild("diagnosisInput") diagnosisInput: ElementRef<HTMLInputElement>
  @ViewChild("auto") matAutocomplete: MatAutocomplete

  rafScoreForm: FormGroup
  url = "https://7dw0imxsfi.execute-api.us-west-2.amazonaws.com/api/"
  icd_url = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search"

  curve: any = shape.curveBundle.beta(1)

  view: any[]
  model_v22_nodes: any[]
  model_v22_links: any[]
  model_v23_nodes: any[]
  model_v23_links: any[]

  private activeTab: number
  private tabLinks: string[] = ["about", "rafscore", "hccs", "hierarchy"]

  constructor(
    private http: HttpClient,
    private _formBuilder: FormBuilder,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  setModelYear(year: string) {
    this.selected_hcc_labels = year === "2019" ? HCC_LABELS_V23 : HCC_LABELS_V22
    this.selected_hcc_list = Object.keys(this.selected_hcc_labels)
    this.hcc_to_icd_list$ = this.http.get(`./assets/hcc_to_icd_${year}.json`)
  }

  ngOnInit(): void {
    this.route.fragment.subscribe(fragment => {
      this.activeTab = Math.max(0, this.tabLinks.indexOf(fragment))
    })

    this.setModelYear("2018")

    // ---- init v22 graph ----
    let hccs_in_hierachy = new Set()
    Object.entries(HCC_GRAPH_V22).forEach(([k, v]) => {
      hccs_in_hierachy.add(k)
      v.forEach(parent => {
        hccs_in_hierachy.add(parent)
      })
    })
    this.model_v22_nodes = Array.from(hccs_in_hierachy).map(k => {
      return { id: k, label: "HCC " + k + ": " + HCC_LABELS_V22[k] }
    })
    this.model_v22_links = []
    Object.entries(HCC_GRAPH_V22).forEach(([k, parents]) => {
      this.model_v22_links = this.model_v22_links.concat(
        parents.map(parent => {
          return { source: parent, target: k }
        })
      )
    })

    // ---- init v23 graph ----
    hccs_in_hierachy = new Set()
    Object.entries(HCC_GRAPH_V23).forEach(([k, v]) => {
      hccs_in_hierachy.add(k)
      v.forEach(parent => {
        hccs_in_hierachy.add(parent)
      })
    })
    this.model_v23_nodes = Array.from(hccs_in_hierachy).map(k => {
      return { id: k, label: "HCC " + k + ": " + HCC_LABELS_V23[k] }
    })
    this.model_v23_links = []
    Object.entries(HCC_GRAPH_V23).forEach(([k, parents]) => {
      this.model_v23_links = this.model_v23_links.concat(
        parents.map(parent => {
          return { source: parent, target: k }
        })
      )
    })

    this.http.get("./assets/icd_codes_map_2019.json").subscribe(data => {
      this.code_map = data
    })

    this.rafScoreForm = this._formBuilder.group({
      diagnoses: [""],
      age: ["70", Validators.required],
      sex: [1, Validators.required],
      model: ["cna", Validators.required],
    })

    this.icdCodes$ = this.searchTerms.pipe(
      debounceTime(100),
      distinctUntilChanged(),
      tap(() => {
        this.isIcdLoading = true
      }),
      switchMap((term: string) => {
        let queryterms = term
          .split(" ")
          .filter(s => Boolean(s.trim()))
          .map(s =>
            // For ICD-like patterns, insert the period so search matches
            s.match(/^[a-zA-Z][0-9][0-9AB][0-9a-zA-Z]/)
              ? this.formatICDwithPeriod(s)
              : s
          )
        return this.http
          .get(this.icd_url, {
            params: new HttpParams()
              .set("terms", queryterms[0])
              .set(
                "q",
                queryterms
                  .slice(1)
                  .map(s => s + "*")
                  .join(" ")
              )
              .set("maxList", "250")
              .set("sf", "code,name")
              .set("df", "code,name"),
          })
          .pipe(
            map(
              response =>
                response[3].map(
                  pair =>
                    <IcdCode>{
                      code: pair[0],
                      description: pair[1],
                      is_billable: this.code_map[pair[0].replace(/\./g, "")][
                        "is_valid"
                      ],
                      hccs: this.code_map[pair[0].replace(/\./g, "")]["hccs"],
                    }
                )
              //.sort((a, b) => a.code.localeCompare(b.code))
            ),
            finalize(() => {
              this.isIcdLoading = false
            })
          )
      })
      // this.http.get<IcdCode[]>(this.url + "icd_10_codes", {
      //   params: new HttpParams().set("query", term).set("ignore_case", "true"),
      // })
    )

    this.rafScoreForm.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => {
          this.isRafLoading = true
        })
      )
      .subscribe(form => {
        this.isRafLoading = true
        this.http
          .get(this.url + "risk_adjust", {
            params: new HttpParams()
              .set(
                "diagnoses",
                this.selectedDiagnoses
                  .map(d => d.split(":")[0].replace(/\./g, ""))
                  .join()
              )
              .set("sex", form.sex)
              .set("age", form.age)
              .set("model", form.model),
          })
          .pipe(
            finalize(() => {
              this.isRafLoading = false
            })
          )
          .subscribe(response => {
            this.rafScore = response
          })
      })
  }

  formatICDwithPeriod(s: string) {
    return s.length > 3 ? s.slice(0, 3) + "." + s.slice(3) : s
  }

  search(term: string): void {
    let normalized_term = term.trim()
    if (normalized_term.length > 2) {
      this.searchTerms.next(normalized_term)
    }
  }

  add(event: MatChipInputEvent): void {
    // Add diagnoses only when MatAutocomplete is not open
    // To make sure this does not conflict with OptionSelected Event
    if (!this.matAutocomplete.isOpen) {
      const input = event.input
      const value = event.value

      // Add our diagnoses
      if ((value || "").trim()) {
        this.selectedDiagnoses.push(value.trim())
      }

      // Reset the input value
      if (input) {
        input.value = ""
      }

      this.rafScoreForm.get("diagnoses").setValue(null)
    }
  }

  remove(diagnoses: string): void {
    const index = this.selectedDiagnoses.indexOf(diagnoses)

    if (index >= 0) {
      this.selectedDiagnoses.splice(index, 1)
    }
  }

  selected(event: MatAutocompleteSelectedEvent): void {
    console.log(event)
    this.selectedDiagnoses.push(event.option.value)
    this.diagnosisInput.nativeElement.value = ""
    this.rafScoreForm.get("diagnoses").setValue(null)
  }
}

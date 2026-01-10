Solar Panel → Smart Meter → AMI → API Gateway
                                      ↓
                            Oracle.submit_meter_reading()
                                      ↓
                              Validate & Store
                                      ↓
                            Emit MeterReadingSubmitted
                                      ↓
                Registry Program รับ Event → mint_tokens_direct()
                                      ↓
                            User ได้รับ GRX tokens ตามพลังงานที่ผลิต